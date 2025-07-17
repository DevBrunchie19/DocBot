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

// Directory for documents
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
app.get('/search', (req, re
