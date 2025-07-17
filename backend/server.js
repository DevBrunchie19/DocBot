import express from 'express';
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import fuzzysort from 'fuzzysort';

const app = express();
const PORT = process.env.PORT || 10000;
const DATA_DIR = './backend/data';

let documents = []; // Store loaded documents

// Function to load and parse documents
async function loadDocuments() {
    console.log('[INFO] Loading documents...');
    documents = []; // Clear existing documents

    const files = fs.readdirSync(DATA_DIR);
    for (const file of files) {
        const filePath = path.join(DATA_DIR, file);
        const ext = path.extname(file).toLowerCase();

        try {
            let text = '';
            if (ext === '.pdf') {
                const dataBuffer = fs.readFileSync(filePath);
                const pdfData = await pdfParse(dataBuffer);
                text = pdfData.text;
            } else if (ext === '.docx') {
                const result = await mammoth.extractRawText({ path: filePath });
                text = result.value;
            } else {
                console.log(`[WARN] Skipping unsupported file: ${file}`);
                continue;
            }

            console.log(`[INFO] Loaded: ${file} (${text.length} characters)`);
            documents.push({ name: file, text });
        } catch (err) {
            console.error(`[ERROR] Failed to load ${file}: ${err.message}`);
        }
    }

    console.log(`[INFO] Total documents loaded: ${documents.length}`);
}

// Chunk text into smaller pieces for fuzzy search
const CHUNK_SIZE = 500; // number of characters per chunk
function chunkText(text) {
    const chunks = [];
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
        chunks.push(text.slice(i, i + CHUNK_SIZE));
    }
    return chunks;
}

// Search function using fuzzysort
async function searchDocuments(query) {
    const results = [];

    for (const doc of documents) {
        const chunks = chunkText(doc.text);
        const matches = fuzzysort.go(query, chunks, { threshold: -1000, limit: 5 });
        for (const match of matches) {
            results.push(match.target);
        }
    }

    return results.slice(0, 5); // return top 5 matches
}

// Watch data folder for changes
fs.watch(DATA_DIR, (eventType, filename) => {
    if (filename) {
        console.log(`[INFO] Change detected in ${filename}, reloading documents...`);
        loadDocuments();
    }
});

// Load documents on startup
loadDocuments();

// Middleware
app.use(express.json());
app.use(express.static('./frontend'));

// API endpoint
app.post('/api/query', async (req, res) => {
    const { query } = req.body;
    if (!query) {
        return res.status(400).json({ error: 'Query is required' });
    }

    try {
        const results = await searchDocuments(query);
        if (results.length === 0) {
            return res.json({ results: ["Sorry, I couldn't find anything related."] });
        }
        res.json({ results });
    } catch (err) {
        console.error(`[ERROR] Search failed: ${err.message}`);
        res.status(500).json({ error: 'Search failed.' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`[INFO] Server running on port ${PORT}`);
});
