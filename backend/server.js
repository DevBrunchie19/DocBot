import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import Fuse from 'fuse.js';

const app = express();
const PORT = process.env.PORT || 3000;

const __dirname = path.resolve();
const dataDir = path.join(__dirname, 'backend', 'data');
const frontendDir = path.join(__dirname, 'frontend');

// Serve static files (frontend)
app.use(express.static(frontendDir));
app.use(cors());

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
        const pdfParse = (await import('pdf-parse')).default;
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

let documents = [];
loadDocuments().then(loaded => {
  documents = loaded;
  console.log(`[INFO] Loaded ${documents.length} documents`);
}).catch(err => {
  console.error('[ERROR] Failed to load documents:', err);
});

// API route for searching
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

  const results = fuse.search(query).map(result => result.item.text.slice(0, 500));
  res.json({ results });
});

// Fallback to index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[INFO] Server running on port ${PORT}`);
});
