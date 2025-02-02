import express, { Request, Response } from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import fs from 'fs';
import cors from 'cors';
import mongoose from 'mongoose';
import { Schema } from 'mongoose';

// MongoDB Connection
const MONGODB_URI = 'mongodb+srv://anishsuman2305:ImWs7gZoYoFnUEoY@cluster0.nz2u9.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
mongoose.connect(MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Interfaces
interface RowData {
    Name: string;
    Amount: number;
    Date: string;
    Verified?: 'Yes' | 'No';
    [key: string]: any;
}

interface ValidationError {
    sheetName: string;
    rowNumber: number;
    error: string;
}

interface ValidationResult {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    errors?: ValidationError[];
    validData?: RowData[];
}

// MongoDB Schemas
const RowSchema = new Schema({
    Name: { type: String, required: true },
    Amount: { type: Number, required: true },
    Date: { type: Date, required: true },
    Verified: { type: String, enum: ['Yes', 'No'] },
    documentId: { type: Schema.Types.ObjectId, ref: 'Document', required: true }
}, { timestamps: true });

const DocumentSchema = new Schema({
    fileName: { type: String, required: true },
    uploadDate: { type: Date, default: Date.now },
    rowCount: { type: Number, required: true }
}, { timestamps: true });

// MongoDB Models
const Row = mongoose.model('Row', RowSchema);
const Document = mongoose.model('Document', DocumentSchema);

// Multer Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Ensure uploads directory exists
        if (!fs.existsSync('uploads/')) {
            fs.mkdirSync('uploads/');
        }
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 2 * 1024 * 1024 // 2MB
    }
});

const app = express();
app.use(express.json());
app.use(cors());

// Validation Functions
const validateRow = (row: RowData, rowIndex: number, sheetName: string): ValidationError[] => {
    const errors: ValidationError[] = [];
    const rowNumber = rowIndex + 2; // Add 2 to account for header row and 0-based index

    if (!row.Name?.trim()) {
        errors.push({
            sheetName,
            rowNumber,
            error: 'Name is required'
        });
    }

    const amount = Number(row.Amount);
    if (!amount || amount <= 0) {
        errors.push({
            sheetName,
            rowNumber,
            error: 'Amount must be a positive number'
        });
    }

    const date = new Date(row.Date);
    const currentDate = new Date();
    if (isNaN(date.getTime())) {
        errors.push({
            sheetName,
            rowNumber,
            error: 'Invalid date format'
        });
    } else if (
        date.getMonth() !== currentDate.getMonth() ||
        date.getFullYear() !== currentDate.getFullYear()
    ) {
        errors.push({
            sheetName,
            rowNumber,
            error: 'Date must be within the current month'
        });
    }

    if (row.Verified && !['Yes', 'No'].includes(row.Verified)) {
        errors.push({
            sheetName,
            rowNumber,
            error: 'Verified must be either "Yes" or "No"'
        });
    }

    return errors;
};

const validateHeaders = (headers: string[], sheetName: string): ValidationError[] => {
    const requiredHeaders = ['Name', 'Amount', 'Date'];
    return requiredHeaders
        .filter(header => !headers.includes(header))
        .map(missingHeader => ({
            sheetName,
            rowNumber: 1,
            error: `Missing required column: ${missingHeader}`
        }));
};

// Validation endpoint
//@ts-ignore
app.post('/validate', upload.single('file'), async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }

        const filePath = req.file.path;
        
        try {
            const workbook = xlsx.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const sheetData = xlsx.utils.sheet_to_json(worksheet) as RowData[];

            if (sheetData.length === 0) {
                return res.status(400).json({
                    message: "File is empty or contains no valid data"
                });
            }

            // Validate headers
            const headers = Object.keys(sheetData[0]);
            const headerErrors = validateHeaders(headers, sheetName);

            if (headerErrors.length > 0) {
                return res.status(400).json({
                    message: "Invalid headers",
                    errors: headerErrors
                });
            }

            // Validate each row
            const validationErrors: ValidationError[] = [];
            const validRows: RowData[] = [];

            sheetData.forEach((row, index) => {
                const rowErrors = validateRow(row, index, sheetName);
                if (rowErrors.length > 0) {
                    validationErrors.push(...rowErrors);
                } else {
                    validRows.push(row);
                }
            });

            // Store the validation result in the session or temporary storage
            const validationResult: ValidationResult = {
                totalRows: sheetData.length,
                validRows: validRows.length,
                invalidRows: sheetData.length - validRows.length,
                errors: validationErrors,
                validData: validRows
            };

            // Store the file path and validation result for later use
            req.app.locals.fileData = {
                filePath,
                validationResult,
                timestamp: Date.now()
            };

            // Return validation result without the actual data
            const { validData, ...validationResponse } = validationResult;
            return res.status(200).json(validationResponse);

        } catch (error) {
            // Clean up file in case of error
            fs.promises.unlink(filePath).catch(console.error);
            throw error;
        }
    } catch (error) {
        console.error("Error validating file:", error);
        return res.status(500).json({ 
            message: "Server error validating file",
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

// Import endpoint
//@ts-ignore
app.post('/import', async (req: Request, res: Response) => {
    try {
        const fileData = req.app.locals.fileData;
        
        if (!fileData || !fileData.filePath || !fileData.validationResult) {
            return res.status(400).json({
                message: "No validated file found. Please validate the file first."
            });
        }

        // Check if validation result is still valid (e.g., not older than 5 minutes)
        if (Date.now() - fileData.timestamp > 5 * 60 * 1000) {
            return res.status(400).json({
                message: "Validation expired. Please validate the file again."
            });
        }

        const { validData } = fileData.validationResult;

        if (!validData || validData.length === 0) {
            return res.status(400).json({
                message: "No valid rows to import"
            });
        }

        // Save to MongoDB
        const document = await Document.create({
            fileName: fileData.filePath.split('/').pop() || 'Imported Document',
            rowCount: validData.length
        });

        const rows = await Row.insertMany(
            //@ts-ignore
            validData.map(row => ({
                ...row,
                documentId: document._id,
                Date: new Date(row.Date)
            }))
        );

        // Clean up the stored file and validation result
        fs.promises.unlink(fileData.filePath).catch(console.error);
        delete req.app.locals.fileData;

        return res.status(200).json({
            message: "File imported successfully",
            documentId: document._id,
            rowCount: rows.length
        });

    } catch (error) {
        console.error("Error importing file:", error);
        return res.status(500).json({ 
            message: "Server error importing file",
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

// Get all documents
//@ts-ignore
app.get('/documents', async (_req: Request, res: Response) => {
    try {
        const documents = await Document.find()
            .sort({ uploadDate: -1 })
            .select('fileName uploadDate rowCount createdAt');
        
        return res.status(200).json({
            message: "Documents retrieved successfully",
            documents
        });
    } catch (error) {
        console.error("Error fetching documents:", error);
        return res.status(500).json({ 
            message: "Server error fetching documents",
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

// Get rows for a specific document
//@ts-ignore
app.get('/documents/:documentId/rows', async (req: Request, res: Response) => {
    try {
        const { documentId } = req.params;
        const { page = 1, limit = 10 } = req.query;
        
        const pageNumber = Number(page);
        const limitNumber = Number(limit);
        
        const rows = await Row.find({ documentId })
            .skip((pageNumber - 1) * limitNumber)
            .limit(limitNumber)
            .sort({ createdAt: -1 });
            
        const totalRows = await Row.countDocuments({ documentId });
        
        return res.status(200).json({
            message: "Rows retrieved successfully",
            rows,
            pagination: {
                currentPage: pageNumber,
                totalPages: Math.ceil(totalRows / limitNumber),
                totalRows,
                rowsPerPage: limitNumber
            }
        });
    } catch (error) {
        console.error("Error fetching rows:", error);
        return res.status(500).json({ 
            message: "Server error fetching rows",
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

// Delete a specific row
//@ts-ignore
app.delete('/documents/:documentId/rows/:rowId', async (req: Request, res: Response) => {
    try {
        const { documentId, rowId } = req.params;
        
        // Delete the row
        await Row.findByIdAndDelete(rowId);
        
        // Update the document's row count
        await Document.findByIdAndUpdate(documentId, {
            $inc: { rowCount: -1 }
        });
        
        return res.status(200).json({
            message: "Row deleted successfully"
        });
    } catch (error) {
        console.error("Error deleting row:", error);
        return res.status(500).json({ 
            message: "Server error deleting row",
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

export default app;