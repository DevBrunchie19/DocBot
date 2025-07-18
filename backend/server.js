// backend/server.js
import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import fuzzysort from 'fuzzysort';
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import mammoth from 'mammoth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.static(path.join(__dirname, '../frontend')));

let documents = [];

/**
 * Extract text from PDF using pdfjs
 */
async function extractTextFromPDF(filePath) {
    console.log(`📖 Extracting text from PDF: ${filePath}`);
    const data = new Uint8Array(await fs.readFile(filePath));
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    let text = '';

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(' ') + ' ';
    }
    return text;
}

/**
 * Extract text from DOCX using mammoth
 */
async function extractTextFromDOCX(filePath) {
    console.log(`📖 Extracting text from DOCX: ${filePath}`);
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
}

/**
 * Loads all documents from backend/data/
 */
async function loadDocuments() {
    const dataDir = path.join(__dirname, 'data');
    try {
        const files = await fs.readdir(dataDir);
        const loadedDocs = [];

        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            const fullPath = path.join(dataDir, file);
            let text = '';

            try {
                if (ext === '.pdf') {
                    text = await extractTextFromPDF(fullPath);
                } else if (ext === '.docx') {
                    text = await extractTextFromDOCX(fullPath);
                } else {
                    console.warn(`⚠️ Skipping unsupported file type: ${file}`);
                    continue;
                }

                if (text.trim()) {
                    loadedDocs.push({
                        filename: file,
                        content: text
                    });
                    console.log(`✅ Loaded ${file}`);
                } else {
                    console.warn(`⚠️ No text found in ${file}`);
                }
            } catch (err) {
                console.error(`❌ Error loading ${file}:`, err.message);
            }
        }

        documents = loadedDocs;
        console.log(`📄 Total documents loaded: ${documents.length}`);
    } catch (err) {
        console.error('❌ Failed to read data directory:', err.message);
    }
}

app.get('/api/search', async (req, res) => {
    const query = req.query.q || '';
    if (!query) return res.json({ results: [] });

    if (documents.length === 0) {
        console.warn('⚠️ No documents loaded to search in');
        return res.json({ results: [] });
    }

    const results = fuzzysort.go(query, documents, {
        key: 'content',
        limit: 5,
        threshold: -10000
    }).map(r => ({
        snippet: r.obj.content.substring(r.index, r.index + 200),
        filename: r.obj.filename
    }));

    res.json({ results });
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Start server
app.listen(PORT, async () => {
    console.log(`[INFO] Server running on port ${PORT}`);
    await loadDocuments();
});
