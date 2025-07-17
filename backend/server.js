import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import Fuse from 'fuse.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Set data directory relative to this file
const dataDir = path.resolve('./backend/data');

// Function to load and parse all documents
async function loadDocuments() {
  const docs = [];
  if (!fs.existsSync(dataDir)) {
    console.warn(`[WARN] Data directory '${dataDir}' does not exist. No documents loaded.`);
    return docs;
  }

  const files = fs.readdirSync(dataDir);
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const filePath = path.join(dataDir, file);
    try {
      if (ext === '.pdf') {
        const dataBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(dataBuffer);
        docs.push({ text: pdfData.text });
      } else if (ext === '.docx') {
        const result = await mammoth.extractRawText({ path: filePath });
        docs.push({ text: result.value });
      } else if (ext === '.txt') {
        const text = fs.readFileSync(filePath, 'utf-8');
        docs.push({ text });
      }
    } catch (err) {
      console.error(`Error loading ${file}:`, err.message);
    }
  }

  return docs;
}

// Load documents at startup
let documents = [];
loadDocuments().then(loaded => {
  documents = loaded;
  console.log(`[INFO] Loaded ${documents.length} documents from /data`);
}).catch(err => {
  console.error('[ERROR] Failed to load documents:', err);
});

// Search API
app.get('/search', (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter ?q=' });
  }

  if (documents.length === 0) {
    return res.status(503).json({ error: 'No documents available to search.' });
  }

  const fuse = new Fuse(documents, {
    keys: ['text'],
    threshold: 0.3,
    minMatchCharLength: 2
  });

  const results = fuse.search(query).map(result => result.item.text.slice(0, 500)); // Limit snippet size

  res.json({ results });
});

// Root
app.get('/', (req, res) => {
  res.send('McHelpie Backend is running');
});

// Start server
app.listen(PORT, () => {
  console.log(`[INFO] Server running on port ${PORT}`);
});
