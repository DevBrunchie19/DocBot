import express from 'express';
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import Fuse from 'fuse.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const dataDir = path.join(__dirname, 'data');
let documents = [];

// Load and index all PDFs/DOCX in the data folder
async function loadDocuments() {
    try {
        const files = fs.readdirSync(dataDir);
        const allDocs = [];

        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            const filePath = path.join(dataDir, file);

            try {
                let textContent = '';

                if (ext === '.pdf') {
                    const pdfBuffer = fs.readFileSync(filePath);
                    const pdfData = await pdfParse(pdfBuffer);
                    textContent = pdfData.text;
                } else if (ext === '.docx') {
                    const docxBuffer = fs.readFileSync(filePath);
                    const result = await mammoth.extractRawText({ buffer: docxBuffer });
                    textContent = result.value;
                } else {
                    console.log(`Skipping unsupported file type: ${file}`);
                    continue;
                }

                allDocs.push({
                    name: file,
                    content: textContent
                });

                console.log(`Loaded: ${file}`);
            } catch (err) {
                console.error(`Error loading ${file}: ${err.message}`);
            }
        }

        documents = allDocs;
        console.log(`[INFO] Loaded ${documents.length} documents`);
    } catch (err) {
        console.error(`Error reading data directory: ${err.message}`);
    }
}

// Setup Fuse.js for fuzzy search
let fuse;
function indexDocuments() {
    const options = {
        includeScore: true,
        threshold: 0.4,
        keys: ['content']
    };
    fuse = new Fuse(documents, options);
}

// Endpoint: search documents
app.post('/search', (req, res) => {
    const query = req.body.query;

    if (!query || !fuse) {
        return res.status(400).json({ error: 'No query provided or index not ready.' });
    }

    const results = fuse.search(query).slice(0, 5).map(r => ({
        text: r.item.content.substring(0, 500) + '...', // snippet
        score: r.score
    }));

    if (results.length === 0) {
        return res.json({ results: [], message: "Sorry, I couldn't find anything related." });
    }

    res.json({ results });
});

// Fallback: serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`[INFO] Server running on port ${PORT}`);
    loadDocuments().then(indexDocuments);
});
