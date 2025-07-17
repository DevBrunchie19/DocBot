import fs from 'fs';
import path from 'path';

const dataDir = path.join(__dirname, 'data');

// Ensure the data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { Document, Packer } = require('docx');
const Fuse = require('fuse.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, '../'))); // Serve index.html

const documentsDir = path.join(__dirname, 'data');
let documents = [];

// Load all documents (PDF/DOCX/TXT)
async function loadDocuments() {
  const files = fs.readdirSync(documentsDir);
  documents = [];

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const filePath = path.join(documentsDir, file);
    let content = '';

    try {
      if (ext === '.pdf') {
        const dataBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(dataBuffer);
        content = pdfData.text;
      } else if (ext === '.docx') {
        // Very basic docx text extraction
        const dataBuffer = fs.readFileSync(filePath);
        const zip = await require('jszip').loadAsync(dataBuffer);
        const textParts = [];
        for (const fileName of Object.keys(zip.files)) {
          if (fileName.match(/word\/document.xml/)) {
            const xmlText = await zip.files[fileName].async('string');
            textParts.push(xmlText.replace(/<[^>]+>/g, ' ')); // Strip XML tags
          }
        }
        content = textParts.join(' ');
      } else if (ext === '.txt') {
        content = fs.readFileSync(filePath, 'utf-8');
      }

      documents.push({
        content,
        fileName: file
      });
    } catch (err) {
      console.error(`Failed to load ${file}: ${err.message}`);
    }
  }

  console.log(`Loaded ${documents.length} documents`);
}

loadDocuments();

app.get('/api/search', (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });

  const fuse = new Fuse(documents, {
    keys: ['content'],
    includeScore: true,
    threshold: 0.4 // Adjust for fuzzy matching
  });

  const results = fuse.search(query).map(r => ({
    text: r.item.content.slice(0, 500) + '...', // Return snippet
    score: r.score
  }));

  res.json({ results });
});

// Fallback to index.html for any other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
