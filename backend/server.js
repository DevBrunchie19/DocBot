// backend/server.js
import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import mammoth from 'mammoth';
import { Configuration, OpenAIApi } from 'openai';
import dotenv from 'dotenv';

dotenv.config(); // For .env file support

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.static(path.join(__dirname, '../frontend')));

const openai = new OpenAIApi(
    new Configuration({
        apiKey: process.env.OPENAI_API_KEY, // 🔑 Load API key from .env
    })
);

let vectorStore = []; // Array of { filename, content, embedding }

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
    return text;
}

/**
 * Extract text from DOCX
 */
async function extractTextFromDOCX(filePath) {
    console.log(`📖 Extracting text from DOCX: ${filePath}`);
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
}

/**
 * Chunk text into smaller pieces
 */
function chunkText(text, chunkSize = 500) {
    const words = text.split(/\s+/);
    const chunks = [];
    for (let i = 0; i < words.length; i += chunkSize) {
        const chunk = words.slice(i, i + chunkSize).join(' ');
        chunks.push(chunk);
    }
    return chunks;
}

/**
 * Create embeddings for all document chunks
 */
async function loadDocuments() {
    const dataDir = path.join(__dirname, 'data');
    try {
        const files = await fs.readdir(dataDir);
        const newVectorStore = [];

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
                    const chunks = chunkText(text, 500); // Split into smaller chunks
                    for (const chunk of chunks) {
                        const response = await openai.createEmbedding({
                            model: 'text-embedding-ada-002',
                            input: chunk,
                        });
                        const [embedding] = response.data.data.map(d => d.embedding);
                        newVectorStore.push({
                            filename: file,
                            content: chunk,
                            embedding
                        });
                    }
                    console.log(`✅ Indexed: ${file} (${chunks.length} chunks)`);
                } else {
                    console.warn(`⚠️ No text found in ${file}`);
                }
            } catch (err) {
                console.error(`❌ Error processing ${file}:`, err.message);
            }
        }

        vectorStore = newVectorStore;
        console.log(`📄 Total chunks indexed: ${vectorStore.length}`);
    } catch (err) {
        console.error('❌ Failed to read data directory:', err.message);
    }
}

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
    const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
    const normA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const normB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
    return dot / (normA * normB);
}

/**
 * API endpoint for semantic search
 */
app.get('/api/search', async (req, res) => {
    const query = req.query.q || '';
    if (!query) return res.json({ results: [] });

    if (vectorStore.length === 0) {
        console.warn('⚠️ No documents loaded to search in');
        return res.json({ results: [] });
    }

    try {
        // Embed the user query
        const response = await openai.createEmbedding({
            model: 'text-embedding-ada-002',
            input: query,
        });
        const queryEmbedding = response.data.data[0].embedding;

        // Find the most similar document chunks
        const scored = vectorStore
            .map(chunk => ({
                ...chunk,
                similarity: cosineSimilarity(queryEmbedding, chunk.embedding),
            }))
            .sort((a, b) => b.similarity - a.similarity);

        const topResults = scored.slice(0, 5).map(r => ({
            snippet: r.content,
            filename: r.filename,
            score: r.similarity.toFixed(4),
        }));

        res.json({ results: topResults });
    } catch (err) {
        console.error('❌ Error during semantic search:', err.message);
        res.status(500).json({ error: 'Semantic search failed' });
    }
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
});
