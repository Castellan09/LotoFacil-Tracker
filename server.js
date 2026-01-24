const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const cron = require('node-cron');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database
async function initializeDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS bets (
                id SERIAL PRIMARY KEY,
                strategy VARCHAR(50) NOT NULL,
                numbers INTEGER[] NOT NULL,
                date DATE NOT NULL,
                result_numbers INTEGER[],
                matches INTEGER,
                prize DECIMAL(10, 2) DEFAULT 0,
                contest_number INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS results (
                id SERIAL PRIMARY KEY,
                contest_number INTEGER UNIQUE NOT NULL,
                numbers INTEGER[] NOT NULL,
                date DATE NOT NULL,
                total_prize DECIMAL(10, 2) DEFAULT 0,
                bets_checked INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ Database initialized successfully');
    } catch (error) {
        console.error('❌ Error initializing database:', error);
    }
}

// Pricing configuration
const PRICING = {
    betCost: 3.50,
    prizes: {
        11: 6.00,
        12: 12.00,
        13: 30.00,
        14: 1500.00,
        15: 1500000.00
    }
};

// ==================== BET GENERATION FUNCTIONS ====================

// Função auxiliar para garantir 15 números únicos
function ensureExactly15Numbers(numbers) {
    const unique = [...new Set(numbers)];
    
    if (unique.length === 15) {
        return unique.sort((a, b) => a - b);
    }
    
    if (unique.length > 15) {
        // Se tem mais de 15, pega os primeiros 15
        return unique.slice(0, 15).sort((a, b) => a - b);
    }
    
    // Se tem menos de 15, completa com números aleatórios
    const available = [];
    for (let i = 1; i <= 25; i++) {
        if (!unique.includes(i)) {
            available.push(i);
        }
    }
    
    // Embaralha os disponíveis
    for (let i = available.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [available[i], available[j]] = [available[j], available[i]];
    }
    
    // Adiciona até ter 15
    while (unique.length < 15 && available.length > 0) {
        unique.push(available.shift());
    }
    
    return unique.sort((a, b) => a - b);
}

// 1. Frequência Ponderada
async function generateWeightedBet() {
    try {
        const result = await pool.query(`
            SELECT numbers FROM results ORDER BY date DESC LIMIT 100
        `);

        const frequency = {};
        for (let i = 1; i <= 25; i++) frequency[i] = 0;

        result.rows.forEach(row => {
            row.numbers.forEach(num => frequency[num]++);
        });

        const weighted = Object.entries(frequency)
            .map(([num, freq]) => ({ num: parseInt(num), weight: freq + Math.random() * 5 }))
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 15)
            .map(item => item.num);

        return ensureExactly15Numbers(weighted);
    } catch (error) {
        console.error('Error in generateWeightedBet:', error);
        return generateRandomBet();
    }
}

// 2. Mix Equilibrado - CORRIGIDO
async function generateBalancedBet() {
    try {
        const result = await pool.query(`
            SELECT numbers FROM results ORDER BY date DESC LIMIT 50
        `);

        const frequency = {};
        for (let i = 1; i <= 25; i++) frequency[i] = 0;

        result.rows.forEach(row => {
            row.numbers.forEach(num => frequency[num]++);
        });

        const sorted = Object.entries(frequency)
            .map(([num, freq]) => ({ num: parseInt(num), freq }))
            .sort((a, b) => b.freq - a.freq);

        const numbers = [];
        
        // 5 mais frequentes
        for (let i = 0; i < 5 && i < sorted.length; i++) {
            numbers.push(sorted[i].num);
        }
        
        // 5 menos frequentes
        for (let i = sorted.length - 1; i >= sorted.length - 5 && i >= 0; i--) {
            if (!numbers.includes(sorted[i].num)) {
                numbers.push(sorted[i].num);
            }
        }
        
        // Completa com números do meio (frequência média)
        const middle = sorted.slice(5, sorted.length - 5);
        for (const item of middle) {
            if (numbers.length >= 15) break;
            if (!numbers.includes(item.num)) {
                numbers.push(item.num);
            }
        }
        
        // Garantir exatamente 15 números
        return ensureExactly15Numbers(numbers);
    } catch (error) {
        console.error('Error in generateBalancedBet:', error);
        return generateRandomBet();
    }
}

// 3. Evitar Extremos
async function generateModerateBet() {
    const numbers = [];
    const range = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    
    while (numbers.length < 15) {
        const num = range[Math.floor(Math.random() * range.length)];
        if (!numbers.includes(num)) {
            numbers.push(num);
        }
    }
    
    return ensureExactly15Numbers(numbers);
}

// 4. Distribuição Uniforme - CORRIGIDO
function generateDistributedBet() {
    const numbers = [];
    
    // Divide 1-25 em 5 grupos de 5 números cada
    const groups = [
        [1, 2, 3, 4, 5],
        [6, 7, 8, 9, 10],
        [11, 12, 13, 14, 15],
        [16, 17, 18, 19, 20],
        [21, 22, 23, 24, 25]
    ];
    
    // Pega 3 números de cada grupo
    groups.forEach(group => {
        const shuffled = [...group].sort(() => Math.random() - 0.5);
        for (let i = 0; i < 3 && i < shuffled.length; i++) {
            if (!numbers.includes(shuffled[i])) {
                numbers.push(shuffled[i]);
            }
        }
    });
    
    // Garantir exatamente 15 números
    return ensureExactly15Numbers(numbers);
}

// 5. Inteligente (combina várias técnicas)
async function generateIntelligentBet() {
    try {
        const result = await pool.query(`
            SELECT numbers FROM results ORDER BY date DESC LIMIT 30
        `);

        const frequency = {};
        const pairs = {};
        
        for (let i = 1; i <= 25; i++) frequency[i] = 0;

        result.rows.forEach(row => {
            row.numbers.forEach(num => frequency[num]++);
            
            for (let i = 0; i < row.numbers.length; i++) {
                for (let j = i + 1; j < row.numbers.length; j++) {
                    const key = `${row.numbers[i]}-${row.numbers[j]}`;
                    pairs[key] = (pairs[key] || 0) + 1;
                }
            }
        });

        const topPairs = Object.entries(pairs)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        const numbers = [];
        topPairs.forEach(([pair]) => {
            const [a, b] = pair.split('-').map(Number);
            if (!numbers.includes(a)) numbers.push(a);
            if (!numbers.includes(b)) numbers.push(b);
        });

        const sorted = Object.entries(frequency)
            .sort((a, b) => b[1] - a[1])
            .map(([num]) => parseInt(num));

        for (const num of sorted) {
            if (numbers.length >= 15) break;
            if (!numbers.includes(num)) numbers.push(num);
        }

        return ensureExactly15Numbers(numbers);
    } catch (error) {
        console.error('Error in generateIntelligentBet:', error);
        return generateRandomBet();
    }
}

// 6. Aleatório Puro
function generateRandomBet() {
    const numbers = [];
    while (numbers.length < 15) {
        const num = Math.floor(Math.random() * 25) + 1;
        if (!numbers.includes(num)) {
            numbers.push(num);
        }
    }
    return ensureExactly15Numbers(numbers);
}

// ==================== MAIN FUNCTIONS ====================

async function generateDailyBets() {
    console.log('🎲 Generating daily bets...');
    
    const strategies = [
        { name: 'weighted', fn: generateWeightedBet },
        { name: 'balanced', fn: generateBalancedBet },
        { name: 'moderate', fn: generateModerateBet },
        { name: 'distributed', fn: generateDistributedBet },
        { name: 'intelligent', fn: generateIntelligentBet },
        { name: 'random', fn: generateRandomBet }
    ];

    const today = new Date().toISOString().split('T')[0];

    for (const strategy of strategies) {
        try {
            const numbers = await strategy.fn();
            
            // Verificar se realmente tem 15 números
            if (numbers.length !== 15) {
                console.error(`❌ Strategy ${strategy.name} generated ${numbers.length} numbers instead of 15!`);
                continue;
            }
            
            await pool.query(
                'INSERT INTO bets (strategy, numbers, date) VALUES ($1, $2, $3)',
                [strategy.name, numbers, today]
            );
            
            console.log(`✅ Bet generated: ${strategy.name} - [${numbers.join(', ')}]`);
        } catch (error) {
            console.error(`❌ Error generating bet for ${strategy.name}:`, error);
        }
    }
    
    console.log('✅ Daily bets generated successfully');
}

async function fetchLatestResult() {
    try {
        // Try primary API
        let response = await fetch('https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil');
        
        if (!response.ok) {
            // Try alternative API
            response = await fetch('https://loteriascaixa-api.herokuapp.com/api/lotofacil/latest');
        }
        
        const data = await response.json();
        
        return {
            contestNumber: data.numero || data.concurso,
            numbers: data.dezenas || data.listaDezenas || data.numbers,
            date: data.dataApuracao || data.data || new Date().toISOString().split('T')[0]
        };
    } catch (error) {
        console.error('❌ Error fetching result:', error);
        return null;
    }
}

async function checkPendingBets() {
    console.log('🔍 Checking pending bets...');
    
    try {
        const latestResult = await fetchLatestResult();
        
        if (!latestResult) {
            console.log('⚠️ No result available');
            return;
        }

        // Check if result already exists
        const existingResult = await pool.query(
            'SELECT id FROM results WHERE contest_number = $1',
            [latestResult.contestNumber]
        );

        if (existingResult.rows.length === 0) {
            // Save new result
            await pool.query(
                'INSERT INTO results (contest_number, numbers, date) VALUES ($1, $2, $3)',
                [latestResult.contestNumber, latestResult.numbers, latestResult.date]
            );
            console.log(`✅ New result saved: Contest ${latestResult.contestNumber}`);
        }

        // Check pending bets
        const pendingBets = await pool.query(
            'SELECT * FROM bets WHERE result_numbers IS NULL'
        );

        let totalPrize = 0;
        let checkedCount = 0;

        for (const bet of pendingBets.rows) {
            const matches = bet.numbers.filter(num => 
                latestResult.numbers.includes(num)
            ).length;

            const prize = PRICING.prizes[matches] || 0;
            totalPrize += prize;

            await pool.query(
                `UPDATE bets 
                 SET result_numbers = $1, matches = $2, prize = $3, contest_number = $4 
                 WHERE id = $5`,
                [latestResult.numbers, matches, prize, latestResult.contestNumber, bet.id]
            );

            checkedCount++;
            console.log(`✅ Bet ${bet.id} checked: ${matches} matches - R$ ${prize.toFixed(2)}`);
        }

        // Update result total
        if (checkedCount > 0) {
            await pool.query(
                'UPDATE results SET total_prize = $1, bets_checked = $2 WHERE contest_number = $3',
                [totalPrize, checkedCount, latestResult.contestNumber]
            );
        }

        console.log(`✅ ${checkedCount} bets checked. Total prize: R$ ${totalPrize.toFixed(2)}`);
    } catch (error) {
        console.error('❌ Error checking bets:', error);
    }
}

// ==================== API ROUTES ====================

// Get all bets
app.get('/api/bets', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM bets ORDER BY date DESC, id DESC LIMIT 100'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching bets:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all results
app.get('/api/results', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM results ORDER BY date DESC LIMIT 50'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching results:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get statistics
app.get('/api/stats', async (req, res) => {
    try {
        const strategies = ['weighted', 'balanced', 'moderate', 'distributed', 'intelligent', 'random'];
        const stats = {};

        for (const strategy of strategies) {
            const result = await pool.query(`
                SELECT 
                    COUNT(*) as total_bets,
                    COALESCE(SUM(prize), 0) as total_prize,
                    COALESCE(AVG(matches), 0) as avg_matches
                FROM bets 
                WHERE strategy = $1 AND result_numbers IS NOT NULL
            `, [strategy]);

            const data = result.rows[0];
            const totalCost = parseInt(data.total_bets) * PRICING.betCost;
            const totalPrize = parseFloat(data.total_prize);
            const netProfit = totalPrize - totalCost;
            const roi = totalCost > 0 ? ((netProfit / totalCost) * 100).toFixed(2) : '0.00';

            stats[strategy] = {
                totalBets: parseInt(data.total_bets),
                totalPrize: totalPrize,
                totalCost: totalCost,
                netProfit: netProfit,
                roi: roi,
                avgMatches: parseFloat(data.avg_matches).toFixed(2)
            };
        }

        res.json(stats);
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get system status
app.get('/api/status', async (req, res) => {
    try {
        const pendingBets = await pool.query(
            'SELECT COUNT(*) FROM bets WHERE result_numbers IS NULL'
        );

        const lastBet = await pool.query(
            'SELECT date FROM bets ORDER BY date DESC LIMIT 1'
        );

        const lastResult = await pool.query(
            'SELECT date, contest_number FROM results ORDER BY date DESC LIMIT 1'
        );

        res.json({
            status: 'active',
            pendingBets: parseInt(pendingBets.rows[0].count),
            lastBetDate: lastBet.rows[0]?.date || null,
            lastResultDate: lastResult.rows[0]?.date || null,
            lastContest: lastResult.rows[0]?.contest_number || null
        });
    } catch (error) {
        console.error('Error fetching status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Calculate investment
app.post('/api/calculate-investment', async (req, res) => {
    try {
        const { amount, strategies } = req.body;
        
        const selectedStrategies = Object.keys(strategies).filter(key => strategies[key]);
        const strategiesCount = selectedStrategies.length;
        
        if (strategiesCount === 0) {
            return res.json({
                error: 'Selecione pelo menos uma estratégia',
                totalBets: 0,
                actualCost: 0,
                change: amount
            });
        }

        const maxBets = Math.floor(amount / PRICING.betCost);
        const betsPerStrategy = Math.floor(maxBets / strategiesCount);
        const totalBets = betsPerStrategy * strategiesCount;
        const actualCost = totalBets * PRICING.betCost;
        const change = amount - actualCost;

        const distribution = {};
        selectedStrategies.forEach(strategy => {
            distribution[strategy] = betsPerStrategy;
        });

        res.json({
            requestedAmount: amount,
            betCost: PRICING.betCost,
            maxPossibleBets: maxBets,
            strategiesCount: strategiesCount,
            betsPerStrategy: betsPerStrategy,
            totalBets: totalBets,
            actualCost: actualCost,
            change: change,
            distribution: distribution
        });
    } catch (error) {
        console.error('Error calculating investment:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get pricing
app.get('/api/pricing', (req, res) => {
    res.json(PRICING);
});

// Generate bets manually (for testing)
app.post('/api/generate-bets', async (req, res) => {
    try {
        await generateDailyBets();
        res.json({ success: true, message: 'Bets generated successfully' });
    } catch (error) {
        console.error('Error generating bets:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Check bets manually (for testing)
app.post('/api/check-bets', async (req, res) => {
    try {
        await checkPendingBets();
        res.json({ success: true, message: 'Bets checked successfully' });
    } catch (error) {
        console.error('Error checking bets:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== CRON JOBS ====================

// Generate bets daily at midnight (Brazil time - GMT-3)
cron.schedule('0 0 * * *', () => {
    console.log('⏰ Running daily bet generation...');
    generateDailyBets();
}, {
    timezone: "America/Sao_Paulo"
});

// Check results every hour
cron.schedule('0 * * * *', () => {
    console.log('⏰ Running hourly bet check...');
    checkPendingBets();
}, {
    timezone: "America/Sao_Paulo"
});

// ==================== SERVER START ====================

async function startServer() {
    try {
        await initializeDatabase();
        
        app.listen(port, () => {
            console.log('🚀 Servidor rodando na porta', port);
            console.log('✅ Database initialized successfully');
            console.log('⏰ Cron jobs agendados:');
            console.log('   - Gerar apostas: TODO DIA às 00:00');
            console.log('   - Conferir resultados: A CADA 1 HORA');
        });
    } catch (error) {
        console.error('❌ Error starting server:', error);
        process.exit(1);
    }
}

startServer();
