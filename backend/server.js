// backend/server.js
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import Fuse from 'fuse.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS
app.use(cors());

// Path to data directory
const dataDir = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`Created missing directory: ${dataDir}`);
}

// Function to load and parse files
async function loadDocuments() {
  const files = fs.readdirSync(dataDir);
  const documents = [];

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const filePath = path.join(dataDir, file);

    try {
      let content = '';

      if (ext === '.txt') {
        content = fs.readFileSync(filePath, 'utf8');
      } else if (ext === '.pdf') {
        const dataBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(dataBuffer);
        content = pdfData.text;
      } else if (ext === '.docx') {
        const result = await mammoth.extractRawText({ path: filePath });
        content = result.value;
      } else {
        console.log(`Skipping unsupported file: ${file}`);
        continue;
      }

      documents.push({ content });
    } catch (err) {
      console.error(`Error reading ${file}:`, err);
    }
  }

  return documents;
}

// API endpoint for search
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter ?q' });
  }

  try {
    const documents = await loadDocuments();

    // Set up fuzzy search
    const fuse = new Fuse(documents, {
      keys: ['content'],
      includeScore: true,
      threshold: 0.4, // Adjust for more/less fuzziness
    });

    const results = fuse.search(query).slice(0, 5).map(r => ({
      content: r.item.content.substring(0, 500) + '...', // Return preview
    }));

    if (results.length === 0) {
      return res.json([{ content: "No relevant information found in documents." }]);
    }

    res.json(results);
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Serve frontend files (optional for deployment)
app.use(express.static(path.join(__dirname, '../')));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
