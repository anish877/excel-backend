"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const xlsx_1 = __importDefault(require("xlsx"));
const fs_1 = __importDefault(require("fs"));
const cors_1 = __importDefault(require("cors"));
const mongoose_1 = __importDefault(require("mongoose"));
const mongoose_2 = require("mongoose");
// MongoDB Connection
const MONGODB_URI = 'mongodb+srv://anishsuman2305:ImWs7gZoYoFnUEoY@cluster0.nz2u9.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
mongoose_1.default.connect(MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));
// MongoDB Schemas
const RowSchema = new mongoose_2.Schema({
    Name: { type: String, required: true },
    Amount: { type: Number, required: true },
    Date: { type: Date, required: true },
    Verified: { type: String, enum: ['Yes', 'No'] },
    documentId: { type: mongoose_2.Schema.Types.ObjectId, ref: 'Document', required: true }
}, { timestamps: true });
const DocumentSchema = new mongoose_2.Schema({
    fileName: { type: String, required: true },
    uploadDate: { type: Date, default: Date.now },
    rowCount: { type: Number, required: true }
}, { timestamps: true });
// MongoDB Models
const Row = mongoose_1.default.model('Row', RowSchema);
const Document = mongoose_1.default.model('Document', DocumentSchema);
// Multer Configuration
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        // Ensure uploads directory exists
        if (!fs_1.default.existsSync('uploads/')) {
            fs_1.default.mkdirSync('uploads/');
        }
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: 2 * 1024 * 1024 // 2MB
    }
});
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cors_1.default)());
// Validation Functions
const validateRow = (row, rowIndex, sheetName) => {
    var _a;
    const errors = [];
    const rowNumber = rowIndex + 2; // Add 2 to account for header row and 0-based index
    if (!((_a = row.Name) === null || _a === void 0 ? void 0 : _a.trim())) {
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
    }
    else if (date.getMonth() !== currentDate.getMonth() ||
        date.getFullYear() !== currentDate.getFullYear()) {
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
const validateHeaders = (headers, sheetName) => {
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
app.post('/validate', upload.single('file'), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }
        const filePath = req.file.path;
        try {
            const workbook = xlsx_1.default.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const sheetData = xlsx_1.default.utils.sheet_to_json(worksheet);
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
            const validationErrors = [];
            const validRows = [];
            sheetData.forEach((row, index) => {
                const rowErrors = validateRow(row, index, sheetName);
                if (rowErrors.length > 0) {
                    validationErrors.push(...rowErrors);
                }
                else {
                    validRows.push(row);
                }
            });
            // Store the validation result in the session or temporary storage
            const validationResult = {
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
            const { validData } = validationResult, validationResponse = __rest(validationResult, ["validData"]);
            return res.status(200).json(validationResponse);
        }
        catch (error) {
            // Clean up file in case of error
            fs_1.default.promises.unlink(filePath).catch(console.error);
            throw error;
        }
    }
    catch (error) {
        console.error("Error validating file:", error);
        return res.status(500).json({
            message: "Server error validating file",
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
}));
// Import endpoint
//@ts-ignore
app.post('/import', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
        const document = yield Document.create({
            fileName: fileData.filePath.split('/').pop() || 'Imported Document',
            rowCount: validData.length
        });
        const rows = yield Row.insertMany(
        //@ts-ignore
        validData.map(row => (Object.assign(Object.assign({}, row), { documentId: document._id, Date: new Date(row.Date) }))));
        // Clean up the stored file and validation result
        fs_1.default.promises.unlink(fileData.filePath).catch(console.error);
        delete req.app.locals.fileData;
        return res.status(200).json({
            message: "File imported successfully",
            documentId: document._id,
            rowCount: rows.length
        });
    }
    catch (error) {
        console.error("Error importing file:", error);
        return res.status(500).json({
            message: "Server error importing file",
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
}));
// Get all documents
//@ts-ignore
app.get('/documents', (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const documents = yield Document.find()
            .sort({ uploadDate: -1 })
            .select('fileName uploadDate rowCount createdAt');
        return res.status(200).json({
            message: "Documents retrieved successfully",
            documents
        });
    }
    catch (error) {
        console.error("Error fetching documents:", error);
        return res.status(500).json({
            message: "Server error fetching documents",
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
}));
// Get rows for a specific document
//@ts-ignore
app.get('/documents/:documentId/rows', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { documentId } = req.params;
        const { page = 1, limit = 10 } = req.query;
        const pageNumber = Number(page);
        const limitNumber = Number(limit);
        const rows = yield Row.find({ documentId })
            .skip((pageNumber - 1) * limitNumber)
            .limit(limitNumber)
            .sort({ createdAt: -1 });
        const totalRows = yield Row.countDocuments({ documentId });
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
    }
    catch (error) {
        console.error("Error fetching rows:", error);
        return res.status(500).json({
            message: "Server error fetching rows",
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
}));
// Delete a specific row
//@ts-ignore
app.delete('/documents/:documentId/rows/:rowId', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { documentId, rowId } = req.params;
        // Delete the row
        yield Row.findByIdAndDelete(rowId);
        // Update the document's row count
        yield Document.findByIdAndUpdate(documentId, {
            $inc: { rowCount: -1 }
        });
        return res.status(200).json({
            message: "Row deleted successfully"
        });
    }
    catch (error) {
        console.error("Error deleting row:", error);
        return res.status(500).json({
            message: "Server error deleting row",
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
}));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
exports.default = app;
