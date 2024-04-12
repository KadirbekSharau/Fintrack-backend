const express = require('express');
const pool = require('../config/db'); 
const authMiddleware = require('../middleware/auth.middleware');

const multer = require('multer');
const fs = require('fs');
const pdfParse = require('pdf-parse');

const upload = multer({ dest: 'uploads/' });

const router = express.Router();

router.get('/all', authMiddleware, async (req, res) => {
    const userId = req.user.userId; 
    try {
        const transactions = await pool.query('SELECT * FROM transactions WHERE user_id = $1', [userId]);
        res.json(transactions.rows);
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error');
    }
});

// Create a new transaction
router.post('/', async (req, res) => {
    const userId = req.user.userId; 
    const { type, amount, address } = req.body;
    try {
        const newTransaction = await pool.query(
            'INSERT INTO transactions (user_id, type, amount, address) VALUES ($1, $2, $3, $4) RETURNING *', 
            [userId, type, amount, address]
        );
        res.json(newTransaction.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error');
    }
});

// Filter transactions by type (income, outcome, transfer)
router.get('/filter', authMiddleware, async (req, res) => {
    const { type } = req.query; 
    const userId = req.user.userId; 

    try {
        if (!['income', 'outcome', 'transfer'].includes(type)) {
            return res.status(400).json({ message: 'Invalid transaction type specified' });
        }

        const transactions = await pool.query(
            'SELECT * FROM transactions WHERE user_id = $1 AND type = $2',
            [userId, type]
        );

        res.json(transactions.rows);
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error');
    }
});

// Get transaction summary (income, outcome, and balance)
router.get('/summary', authMiddleware, async (req, res) => {
    const userId = req.user.userId;

    try {
        const { rows: transactions } = await pool.query(`
            SELECT type, SUM(amount) AS total
            FROM transactions
            WHERE user_id = $1
            GROUP BY type
        `, [userId]);

        const balance = transactions.reduce((acc, curr) => {
            if (curr.type === 'income') return acc + parseFloat(curr.total);
            if (curr.type === 'outcome') return acc - parseFloat(curr.total);
            return acc;
        }, 0);

        res.json({ transactions, balance });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});


router.post('/import', authMiddleware, upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send("Please upload a file.");
    }

    try {
        const dataBuffer = fs.readFileSync(req.file.path);
        const data = await pdfParse(dataBuffer);
        
        const transactions = parseTransactions(data.text, req.user.userId);

        for (const transaction of transactions) {
            console.log(transaction)
            await insertTransaction(transaction, req.user.userId);
        }

        fs.unlinkSync(req.file.path);

        res.send({ message: 'Transactions imported successfully', count: transactions.length });
    } catch (error) {
        console.error('Error importing transactions:', error);
        res.status(500).send('Error importing transactions');
    }
});

function parseTransactions(text, userId) {
    const lines = text.split('\n');
  
    const transactionLines = lines.filter(line => line.match(/^\d{2}\.\d{2}\.\d{2}\s+/));
  
    return transactionLines.map(line => {
        const transactionRegex = /^(\d{2}\.\d{2}\.\d{2})\s+(-?\d[\d\s,]*\d)\s+([^\s]+)\s+(.+)$/;
        const matches = line.match(transactionRegex);
        
        if (matches) {
            const date = matches[1]; 
            const rawAmount = matches[2].replace(/[\s,]/g, '');
            const amount = parseFloat(rawAmount);
            const transactionType = matches[3];
            const details = matches[4];
            console.log(matches)
            
            const type = transactionType === 'Transfers' ? 'transfer'
                        : amount > 0 ? 'income' : 'outcome';

            return {
                userId,
                date, 
                amount,
                type,
                details
            };
        }
        
        return null; 
    }).filter(transaction => transaction !== null);
}


async function insertTransaction(transaction, userId) {
    const { date, details, amount, type } = transaction;
    await pool.query(
        'INSERT INTO transactions (user_id, date, type, amount, address) VALUES ($1, $2, $3, $4, $5)',
        [userId, date, type, amount, details]
    );
}

module.exports = router;