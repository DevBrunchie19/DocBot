import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Fuse from 'fuse.js';
import fuzzysort from 'fuzzysort';
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.static(path.join(__dirname, '../frontend')));

let paragraphs = [];

/**
 * Extract text from PDF and split into paragraph-level sections
 */
async function extractParagraphsFromPDF(filePath, filename) {
    const data = new Uint8Array(await fs.readFile(filePath));
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const paraSections = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();

        let rawText = '';
        let lastY = null;

        for (const item of content.items) {
            if (lastY === null || Math.abs(item.transform[5] - lastY) > 10) {
                rawText += '\n';
            }
            rawText += item.str + ' ';
            lastY = item.transform[5];
        }

        const splitParas = rawText.split(/\n{2,}|(?<=\.)\s{2,}/);

        for (const para of splitParas) {
            const clean = para.trim();
            if (clean) {
                paraSections.push({
                    filename,
                    paragraph: paraSections.length + 1,
                    content: clean
                });
            }
        }
    }

    return paraSections;
}

function findParagraphsWithKeywords(paragraphs, keywords) {
    const fuse = new Fuse(paragraphs, {
        keys: ['content'],
        threshold: 0.4,
        includeScore: true,
    });

    const matches = new Set();

    for (const keyword of keywords) {
        const results = fuse.search(keyword);
        results.forEach(result => matches.add(result.item));
    }

    return Array.from(matches);
}

function highlightKeywords(text, keywords) {
    const escapedKeywords = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`\\b(${escapedKeywords.join('|')})\\b`, 'gi');
    return text.replace(regex, '**$1**');
}

async function handlePDFQuery(filePath, filename, keywords) {
    const paragraphs = await extractParagraphsFromPDF(filePath, filename);
    const matchedParas = findParagraphsWithKeywords(paragraphs, keywords);

    return matchedParas.map(p => ({
        paragraph: p.paragraph,
        content: highlightKeywords(p.content, keywords)
    }));
}

/**
 * Load all documents from data directory
 */
async function loadDocuments() {
    const dataDir = path.join(__dirname, 'data');
    try {
        const files = await fs.readdir(dataDir);
        const loadedParagraphs = [];

        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            const fullPath = path.join(dataDir, file);

            try {
                if (ext === '.pdf') {
                    const pdfParagraphs = await extractParagraphsFromPDF(fullPath, file);
                    loadedParagraphs.push(...pdfParagraphs);
                } else {
                    console.warn(`⚠️ Skipping unsupported file: ${file}`);
                }
            } catch (err) {
                console.error(`❌ Error processing ${file}:`, err.message);
            }
        }

        paragraphs = loadedParagraphs;
        console.log(`📄 Total paragraphs loaded: ${paragraphs.length}`);
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

    if (paragraphs.length === 0) {
        console.warn('⚠️ No paragraphs loaded to search in');
        return res.json({ results: [] });
    }

    const keywords = query.trim().split(/\s+/);

    const results = fuzzysort.go(query, paragraphs, {
        key: 'content',
        limit: 5,
        threshold: -1000
    });

    const formatted = results.map(r => ({
        content: highlightKeywords(r.obj.content, keywords),
        filename: r.obj.filename,
        paragraph: r.obj.paragraph
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
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`[INFO] Server running on port ${PORT}`);
    await loadDocuments();
    watchDataDirectory();
});

