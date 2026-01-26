const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const cron = require('node-cron');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ==================== DATABASE ====================

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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CHECK (array_length(numbers, 1) = 15)
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
                prize_11 DECIMAL(10, 2) DEFAULT 0,
                prize_12 DECIMAL(10, 2) DEFAULT 0,
                prize_13 DECIMAL(10, 2) DEFAULT 0,
                prize_14 DECIMAL(10, 2) DEFAULT 0,
                prize_15 DECIMAL(10, 2) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ Database OK');
    } catch (error) {
        console.error('❌ Database error:', error);
    }
}

const PRICING = { betCost: 3.50 };

// ==================== BET GENERATION ====================

function ensureExactly15Numbers(numbers) {
    const unique = [...new Set(numbers)];
    if (unique.length === 15) return unique.sort((a, b) => a - b);
    if (unique.length > 15) return unique.slice(0, 15).sort((a, b) => a - b);
    const available = [];
    for (let i = 1; i <= 25; i++) {
        if (!unique.includes(i)) available.push(i);
    }
    for (let i = available.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [available[i], available[j]] = [available[j], available[i]];
    }
    while (unique.length < 15 && available.length > 0) {
        unique.push(available.shift());
    }
    return unique.sort((a, b) => a - b);
}

async function generateWeightedBet() {
    try {
        const result = await pool.query('SELECT numbers FROM results ORDER BY date DESC LIMIT 100');
        const frequency = {};
        for (let i = 1; i <= 25; i++) frequency[i] = 0;
        result.rows.forEach(row => row.numbers.forEach(num => frequency[num]++));
        const weighted = Object.entries(frequency)
            .map(([num, freq]) => ({ num: parseInt(num), weight: freq + Math.random() * 5 }))
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 15)
            .map(item => item.num);
        return ensureExactly15Numbers(weighted);
    } catch { return generateRandomBet(); }
}

async function generateBalancedBet() {
    try {
        const result = await pool.query('SELECT numbers FROM results ORDER BY date DESC LIMIT 50');
        const frequency = {};
        for (let i = 1; i <= 25; i++) frequency[i] = 0;
        result.rows.forEach(row => row.numbers.forEach(num => frequency[num]++));
        const sorted = Object.entries(frequency)
            .map(([num, freq]) => ({ num: parseInt(num), freq }))
            .sort((a, b) => b.freq - a.freq);
        const numbers = [];
        for (let i = 0; i < 5 && i < sorted.length; i++) numbers.push(sorted[i].num);
        for (let i = sorted.length - 1; i >= sorted.length - 5 && i >= 0; i--) {
            if (!numbers.includes(sorted[i].num)) numbers.push(sorted[i].num);
        }
        const middle = sorted.slice(5, sorted.length - 5);
        for (const item of middle) {
            if (numbers.length >= 15) break;
            if (!numbers.includes(item.num)) numbers.push(item.num);
        }
        return ensureExactly15Numbers(numbers);
    } catch { return generateRandomBet(); }
}

async function generateModerateBet() {
    const numbers = [];
    const range = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    while (numbers.length < 15) {
        const num = range[Math.floor(Math.random() * range.length)];
        if (!numbers.includes(num)) numbers.push(num);
    }
    return ensureExactly15Numbers(numbers);
}

function generateDistributedBet() {
    const numbers = [];
    const groups = [[1,2,3,4,5], [6,7,8,9,10], [11,12,13,14,15], [16,17,18,19,20], [21,22,23,24,25]];
    groups.forEach(group => {
        const shuffled = [...group].sort(() => Math.random() - 0.5);
        for (let i = 0; i < 3; i++) {
            if (!numbers.includes(shuffled[i])) numbers.push(shuffled[i]);
        }
    });
    return ensureExactly15Numbers(numbers);
}

async function generateIntelligentBet() {
    try {
        const result = await pool.query('SELECT numbers FROM results ORDER BY date DESC LIMIT 30');
        const frequency = {}, pairs = {};
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
        const topPairs = Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const numbers = [];
        topPairs.forEach(([pair]) => {
            const [a, b] = pair.split('-').map(Number);
            if (!numbers.includes(a)) numbers.push(a);
            if (!numbers.includes(b)) numbers.push(b);
        });
        const sorted = Object.entries(frequency).sort((a, b) => b[1] - a[1]).map(([num]) => parseInt(num));
        for (const num of sorted) {
            if (numbers.length >= 15) break;
            if (!numbers.includes(num)) numbers.push(num);
        }
        return ensureExactly15Numbers(numbers);
    } catch { return generateRandomBet(); }
}

function generateRandomBet() {
    const numbers = [];
    while (numbers.length < 15) {
        const num = Math.floor(Math.random() * 25) + 1;
        if (!numbers.includes(num)) numbers.push(num);
    }
    return ensureExactly15Numbers(numbers);
}

// ==================== AUTOMATED GENERATION ====================

async function generateDailyBets() {
    console.log('🎲 Gerando apostas diárias...');
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
            if (numbers.length !== 15) {
                console.error(`❌ ${strategy.name}: ${numbers.length} números`);
                continue;
            }
            await pool.query('INSERT INTO bets (strategy, numbers, date) VALUES ($1, $2, $3)', [strategy.name, numbers, today]);
            console.log(`✅ ${strategy.name}: [${numbers.join(', ')}]`);
        } catch (error) {
            console.error(`❌ ${strategy.name}:`, error.message);
        }
    }
    console.log('✅ Apostas geradas!');
}

// ==================== RESULT CHECKING ====================

async function fetchLatestResult() {
    try {
        console.log('🔍 Buscando resultado...');
        const response = await fetch('https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil');
        if (!response.ok) throw new Error(`API: ${response.status}`);
        const data = await response.json();
        const prizes = { 11: 0, 12: 0, 13: 0, 14: 0, 15: 0 };
        if (data.listaRateioPremio && Array.isArray(data.listaRateioPremio)) {
            data.listaRateioPremio.forEach(item => {
                const faixa = parseInt(item.faixa);
                const valor = parseFloat(item.valorPremio) || 0;
                if (faixa === 1) prizes[15] = valor;
                else if (faixa === 2) prizes[14] = valor;
                else if (faixa === 3) prizes[13] = valor;
                else if (faixa === 4) prizes[12] = valor;
                else if (faixa === 5) prizes[11] = valor;
            });
        }
        return {
            contestNumber: parseInt(data.numero),
            numbers: data.dezenasSorteadasOrdemSorteio.map(n => parseInt(n)),
            date: data.dataApuracao,
            prizes: prizes
        };
    } catch (error) {
        console.error('❌ Erro:', error.message);
        return null;
    }
}

async function checkPendingBets() {
    console.log('🔍 Conferindo apostas...');
    try {
        const latestResult = await fetchLatestResult();
        if (!latestResult) {
            console.log('⚠️ Sem resultado');
            return;
        }
        console.log(`📊 Concurso ${latestResult.contestNumber}`);
        
        const existing = await pool.query('SELECT id FROM results WHERE contest_number = $1', [latestResult.contestNumber]);
        if (existing.rows.length === 0) {
            console.log(`🆕 Novo resultado`);
            await pool.query(
                'INSERT INTO results (contest_number, numbers, date, prize_11, prize_12, prize_13, prize_14, prize_15) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [latestResult.contestNumber, latestResult.numbers, latestResult.date, latestResult.prizes[11], latestResult.prizes[12], latestResult.prizes[13], latestResult.prizes[14], latestResult.prizes[15]]
            );
            console.log(`✅ Salvo: [${latestResult.numbers.join(', ')}]`);
        }
        
        const pending = await pool.query('SELECT * FROM bets WHERE result_numbers IS NULL ORDER BY date ASC');
        if (pending.rows.length === 0) {
            console.log('ℹ️ Sem apostas pendentes');
            return;
        }
        
        console.log(`🎯 ${pending.rows.length} apostas...`);
        let totalPrize = 0, checkedCount = 0;
        for (const bet of pending.rows) {
            const matches = bet.numbers.filter(num => latestResult.numbers.includes(num)).length;
            const prize = latestResult.prizes[matches] || 0;
            totalPrize += prize;
            await pool.query('UPDATE bets SET result_numbers = $1, matches = $2, prize = $3, contest_number = $4 WHERE id = $5',
                [latestResult.numbers, matches, prize, latestResult.contestNumber, bet.id]);
            checkedCount++;
            console.log(`  ✓ ${bet.id} (${bet.strategy}): ${matches} acertos - R$ ${prize.toFixed(2)}`);
        }
        await pool.query('UPDATE results SET total_prize = $1, bets_checked = $2 WHERE contest_number = $3',
            [totalPrize, checkedCount, latestResult.contestNumber]);
        console.log(`✅ ${checkedCount} apostas. Total: R$ ${totalPrize.toFixed(2)}`);
    } catch (error) {
        console.error('❌ Erro:', error);
    }
}

// ==================== API ====================

app.get('/api/bets', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM bets ORDER BY date DESC, id DESC LIMIT 200');
        res.json(result.rows);
    } catch { res.status(500).json({ error: 'Erro' }); }
});

app.get('/api/results', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM results ORDER BY date DESC LIMIT 50');
        res.json(result.rows);
    } catch { res.status(500).json({ error: 'Erro' }); }
});

app.get('/api/stats', async (req, res) => {
    try {
        const strategies = ['weighted', 'balanced', 'moderate', 'distributed', 'intelligent', 'random'];
        const stats = {};
        for (const strategy of strategies) {
            const result = await pool.query(
                'SELECT COUNT(*) as total_bets, COALESCE(SUM(prize), 0) as total_prize, COALESCE(AVG(matches), 0) as avg_matches FROM bets WHERE strategy = $1 AND result_numbers IS NOT NULL',
                [strategy]
            );
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
    } catch { res.status(500).json({ error: 'Erro' }); }
});

app.get('/api/status', async (req, res) => {
    try {
        const pending = await pool.query('SELECT COUNT(*) FROM bets WHERE result_numbers IS NULL');
        const lastBet = await pool.query('SELECT date FROM bets ORDER BY date DESC LIMIT 1');
        const lastResult = await pool.query('SELECT date, contest_number FROM results ORDER BY date DESC LIMIT 1');
        res.json({
            status: 'active',
            pendingBets: parseInt(pending.rows[0].count),
            lastBetDate: lastBet.rows[0]?.date || null,
            lastResultDate: lastResult.rows[0]?.date || null,
            lastContest: lastResult.rows[0]?.contest_number || null
        });
    } catch { res.status(500).json({ error: 'Erro' }); }
});

app.get('/api/pricing', (req, res) => res.json(PRICING));

app.post('/api/generate-bets', async (req, res) => {
    try {
        await generateDailyBets();
        res.json({ success: true });
    } catch { res.status(500).json({ error: 'Erro' }); }
});

app.post('/api/check-bets', async (req, res) => {
    try {
        await checkPendingBets();
        res.json({ success: true });
    } catch { res.status(500).json({ error: 'Erro' }); }
});

app.post('/api/generate-custom', async (req, res) => {
    try {
        const { distribution } = req.body;
        const strategies = {
            weighted: generateWeightedBet, balanced: generateBalancedBet,
            moderate: generateModerateBet, distributed: generateDistributedBet,
            intelligent: generateIntelligentBet, random: generateRandomBet
        };
        const today = new Date().toISOString().split('T')[0];
        const generated = [];
        for (const [name, count] of Object.entries(distribution)) {
            if (count > 0 && strategies[name]) {
                for (let i = 0; i < count; i++) {
                    const numbers = await strategies[name]();
                    const result = await pool.query(
                        'INSERT INTO bets (strategy, numbers, date) VALUES ($1, $2, $3) RETURNING *',
                        [name, numbers, today]
                    );
                    generated.push(result.rows[0]);
                }
            }
        }
        res.json({ success: true, generated: generated.length, bets: generated });
    } catch (error) {
        console.error('Erro:', error);
        res.status(500).json({ error: 'Erro' });
    }
});

// ==================== CRON ====================

cron.schedule('0 0 * * *', () => {
    console.log('⏰ [CRON] Geração diária');
    generateDailyBets();
}, { timezone: "America/Sao_Paulo" });

cron.schedule('0 * * * *', () => {
    console.log('⏰ [CRON] Conferência');
    checkPendingBets();
}, { timezone: "America/Sao_Paulo" });

// ==================== START ====================

async function startServer() {
    try {
        await initializeDatabase();
        app.listen(port, () => {
            console.log('');
            console.log('═══════════════════════════════════════');
            console.log('🚀 LOTOFÁCIL TRACKER ATIVO');
            console.log('═══════════════════════════════════════');
            console.log(`📡 Porta: ${port}`);
            console.log(`✅ Database: OK`);
            console.log('');
            console.log('⏰ CRON:');
            console.log('   📅 Gerar: TODO DIA 00:00 BRT');
            console.log('   🔍 Conferir: A CADA 1 HORA');
            console.log('');
            console.log('💰 Custo: R$ 3,50/aposta');
            console.log('═══════════════════════════════════════');
        });
    } catch (error) {
        console.error('❌ Erro:', error);
        process.exit(1);
    }
}

startServer();
