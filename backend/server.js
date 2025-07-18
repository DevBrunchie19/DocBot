// backend/server.js
import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import fssync from 'fs';
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
 * Extract text from PDF
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

    console.log(`✅ Extracted ${text.length} characters from PDF`);
    return text;
}

/**
 * Extract text from DOCX
 */
async function extractTextFromDOCX(filePath) {
    console.log(`📖 Extracting text from DOCX: ${filePath}`);
    const result = await mammoth.extractRawText({ path: filePath });
    console.log(`✅ Extracted ${result.value.length} characters from DOCX`);
    return result.value;
}

/**
 * Load all documents from data directory
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
                    console.warn(`⚠️ Skipping unsupported file: ${file}`);
                    continue;
                }

                if (text.trim()) {
                    loadedDocs.push({
                        filename: file,
                        content: text
                    });
                    console.log(`✅ Loaded: ${file} (${text.length} characters)`);
                    console.log(`🔍 Preview of loaded content from ${file}:`, text.slice(0, 300));
                } else {
                    console.warn(`⚠️ No text found in ${file}`);
                }
            } catch (err) {
                console.error(`❌ Error processing ${file}:`, err.message);
            }
        }

        documents = loadedDocs;
        console.log(`📄 Total documents loaded: ${documents.length}`);
    } catch (err) {
        console.error('❌ Failed to read data directory:', err.message);
    }
}

/**
 * Watch the data directory for changes
 */
function watchDataDirectory() {
    const dataDir = path.join(__dirname, 'data');
    console.log(`👀 Watching ${dataDir} for changes...`);

    fssync.watch(dataDir, async (eventType, filename) => {
        if (filename) {
            console.log(`🔄 Detected ${eventType} on ${filename}`);
            await loadDocuments();
        }
    });
}

/**
 * API endpoint for search
 */
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
        threshold: -1000
    });

    const getSnippet = (content, query, index) => {
        const safeIndex = index >= 0 ? index : content.toLowerCase().indexOf(query.toLowerCase());
        const start = Math.max(0, safeIndex);
        return content.substring(start, start + 300);
    };

    if (results.total === 0) {
        console.log(`🔍 No fuzzy matches found for "${query}". Trying basic keyword search...`);
        const fallback = documents
            .filter(doc => doc.content.toLowerCase().includes(query.toLowerCase()))
            .map(doc => ({
                snippet: getSnippet(doc.content, query, -1),
                filename: doc.filename
            }));
        return res.json({ results: fallback });
    }

    const formatted = results.map(r => ({
        snippet: getSnippet(r.obj.content, query, r.index),
        filename: r.obj.filename
    }));

    console.log(`🔍 Search for "${query}" returned ${formatted.length} result(s)`);
    res.json({ results: formatted });
});

/**
 * Serve frontend
 */
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

/**
 * Start server
 */
app.listen(PORT, async () => {
    console.log(`[INFO] Server running on port ${PORT}`);
    await loadDocuments();
    watchDataDirectory();
});
