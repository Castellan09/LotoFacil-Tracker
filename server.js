const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const cron = require('node-cron');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ==================== CONSTANTS ====================

const PRICING = { betCost: 3.50 };

// VALORES REAIS DOS PRÊMIOS LOTOFÁCIL
const PRIZE_VALUES = {
    15: 850000,  // Média do prêmio principal (varia)
    14: 1400,    // Média do prêmio de 14 acertos (varia)
    13: 35,      // FIXO
    12: 14,      // FIXO
    11: 7,       // FIXO
    10: 0,       // Não ganha nada
    9: 0,
    8: 0,
    7: 0,
    6: 0,
    5: 0,
    4: 0,
    3: 0,
    2: 0,
    1: 0,
    0: 0
};

function getTodayBrazil() {
    const now = new Date();
    const brazilTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
    return brazilTime.toISOString().split('T')[0];
}

// ==================== DATABASE ====================

async function initializeDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS bets (
                id SERIAL PRIMARY KEY,
                strategy VARCHAR(50) NOT NULL,
                numbers INTEGER[] NOT NULL,
                date DATE NOT NULL,
                type VARCHAR(20) DEFAULT 'auto',
                result_numbers INTEGER[],
                matches INTEGER,
                prize DECIMAL(10, 2) DEFAULT 0,
                contest_number INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CHECK (array_length(numbers, 1) = 15)
            )
        `);

        await pool.query(`
            DO $$ BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bets' AND column_name='type') THEN
                    ALTER TABLE bets ADD COLUMN type VARCHAR(20) DEFAULT 'auto';
                END IF;
            END $$;
        `);

        await pool.query(`UPDATE bets SET type = 'auto' WHERE type IS NULL`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS results (
                id SERIAL PRIMARY KEY,
                contest_number INTEGER UNIQUE NOT NULL,
                numbers INTEGER[] NOT NULL,
                date DATE NOT NULL,
                total_prize DECIMAL(10, 2) DEFAULT 0,
                total_cost DECIMAL(10, 2) DEFAULT 0,
                balance DECIMAL(10, 2) DEFAULT 0,
                bets_checked INTEGER DEFAULT 0,
                prize_11 DECIMAL(10, 2) DEFAULT 7,
                prize_12 DECIMAL(10, 2) DEFAULT 14,
                prize_13 DECIMAL(10, 2) DEFAULT 35,
                prize_14 DECIMAL(10, 2) DEFAULT 1400,
                prize_15 DECIMAL(10, 2) DEFAULT 850000,
                source VARCHAR(50) DEFAULT 'manual',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            DO $$ BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='results' AND column_name='source') THEN
                    ALTER TABLE results ADD COLUMN source VARCHAR(50) DEFAULT 'manual';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='results' AND column_name='total_cost') THEN
                    ALTER TABLE results ADD COLUMN total_cost DECIMAL(10, 2) DEFAULT 0;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='results' AND column_name='balance') THEN
                    ALTER TABLE results ADD COLUMN balance DECIMAL(10, 2) DEFAULT 0;
                END IF;
            END $$;
        `);

        console.log('✅ Database OK');
    } catch (error) {
        console.error('❌ Database error:', error);
    }
}

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

async function generateDailyBets() {
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('🎲 GERANDO 6 APOSTAS DIÁRIAS');
    console.log('═══════════════════════════════════════');
    
    const strategies = [
        { name: 'weighted', fn: generateWeightedBet },
        { name: 'balanced', fn: generateBalancedBet },
        { name: 'moderate', fn: generateModerateBet },
        { name: 'distributed', fn: generateDistributedBet },
        { name: 'intelligent', fn: generateIntelligentBet },
        { name: 'random', fn: generateRandomBet }
    ];
    
    const today = getTodayBrazil();
    console.log(`📅 Data: ${today}`);
    console.log('');
    
    for (const strategy of strategies) {
        try {
            const numbers = await strategy.fn();
            if (numbers.length !== 15) {
                console.error(`❌ ${strategy.name}: ${numbers.length} números`);
                continue;
            }
            await pool.query(
                'INSERT INTO bets (strategy, numbers, date, type) VALUES ($1, $2, $3, $4)',
                [strategy.name, numbers, today, 'auto']
            );
            console.log(`✅ ${strategy.name}: [${numbers.join(', ')}]`);
        } catch (error) {
            console.error(`❌ ${strategy.name}:`, error.message);
        }
    }
    
    console.log('');
    console.log('✅ 6 APOSTAS DIÁRIAS GERADAS!');
    console.log('═══════════════════════════════════════');
    console.log('');
}

// ==================== RESULT CHECKING ====================

async function checkBetsWithResult(resultData) {
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('🎯 CONFERINDO APOSTAS');
    console.log('═══════════════════════════════════════');
    console.log(`📊 Concurso: ${resultData.contestNumber}`);
    console.log(`📅 Data: ${resultData.date}`);
    console.log(`🎲 Números: [${resultData.numbers.join(', ')}]`);
    console.log(`📡 Fonte: ${resultData.source}`);
    console.log('');
    
    try {
        const existing = await pool.query(
            'SELECT id FROM results WHERE contest_number = $1',
            [resultData.contestNumber]
        );
        
        if (existing.rows.length > 0) {
            console.log(`ℹ️ Concurso ${resultData.contestNumber} já conferido`);
            console.log('═══════════════════════════════════════');
            return { success: true, checked: 0, totalPrize: 0, message: 'Já conferido' };
        }
        
        const pending = await pool.query(
            'SELECT * FROM bets WHERE result_numbers IS NULL ORDER BY date ASC'
        );
        
        if (pending.rows.length === 0) {
            console.log('ℹ️ Sem apostas pendentes');
            console.log('═══════════════════════════════════════');
            return { success: true, checked: 0, totalPrize: 0, message: 'Sem apostas pendentes' };
        }
        
        console.log(`📋 ${pending.rows.length} apostas pendentes`);
        console.log('');
        console.log('Conferindo...');
        console.log('─────────────────────────────────────────');
        
        let totalPrize = 0;
        let totalCost = 0;
        let checkedCount = 0;
        
        for (const bet of pending.rows) {
            const matches = bet.numbers.filter(num => 
                resultData.numbers.includes(num)
            ).length;
            
            const prize = resultData.prizes[matches] || 0;
            totalPrize += prize;
            totalCost += PRICING.betCost;
            
            await pool.query(
                `UPDATE bets 
                 SET result_numbers = $1, matches = $2, prize = $3, contest_number = $4 
                 WHERE id = $5`,
                [resultData.numbers, matches, prize, resultData.contestNumber, bet.id]
            );
            
            checkedCount++;
            const typeEmoji = bet.type === 'auto' ? '🤖' : '🎲';
            const prizeEmoji = prize > 0 ? '💰' : '  ';
            console.log(`${prizeEmoji} #${bet.id} ${typeEmoji} ${bet.strategy.padEnd(15)} → ${matches} acertos → R$ ${prize.toFixed(2)}`);
        }
        
        const balance = totalPrize - totalCost;
        
        console.log('🆕 Salvando resultado...');
        await pool.query(
            `INSERT INTO results (
                contest_number, numbers, date,
                prize_11, prize_12, prize_13, prize_14, prize_15, 
                source, total_prize, total_cost, balance, bets_checked
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
                resultData.contestNumber,
                resultData.numbers,
                resultData.date,
                resultData.prizes[11],
                resultData.prizes[12],
                resultData.prizes[13],
                resultData.prizes[14],
                resultData.prizes[15],
                resultData.source,
                totalPrize,
                totalCost,
                balance,
                checkedCount
            ]
        );
        console.log('✅ Resultado salvo!');
        
        console.log('─────────────────────────────────────────');
        console.log('');
        console.log(`✅ ${checkedCount} APOSTAS CONFERIDAS!`);
        console.log(`💰 Prêmios: R$ ${totalPrize.toFixed(2)}`);
        console.log(`💵 Investimento: R$ ${totalCost.toFixed(2)}`);
        console.log(`📊 Saldo do Dia: R$ ${balance.toFixed(2)} ${balance >= 0 ? '✅' : '❌'}`);
        console.log('═══════════════════════════════════════');
        console.log('');
        
        return { success: true, checked: checkedCount, totalPrize, balance };
    } catch (error) {
        console.error('❌ ERRO:', error);
        console.log('═══════════════════════════════════════');
        return { success: false, error: error.message };
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
        const stats = { all: {}, auto: {}, manual: {} };
        
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
            stats.all[strategy] = {
                totalBets: parseInt(data.total_bets),
                totalPrize, totalCost, netProfit, roi,
                avgMatches: parseFloat(data.avg_matches).toFixed(2)
            };
        }
        
        for (const strategy of strategies) {
            const result = await pool.query(
                'SELECT COUNT(*) as total_bets, COALESCE(SUM(prize), 0) as total_prize, COALESCE(AVG(matches), 0) as avg_matches FROM bets WHERE strategy = $1 AND type = $2 AND result_numbers IS NOT NULL',
                [strategy, 'auto']
            );
            const data = result.rows[0];
            const totalCost = parseInt(data.total_bets) * PRICING.betCost;
            const totalPrize = parseFloat(data.total_prize);
            const netProfit = totalPrize - totalCost;
            const roi = totalCost > 0 ? ((netProfit / totalCost) * 100).toFixed(2) : '0.00';
            stats.auto[strategy] = {
                totalBets: parseInt(data.total_bets),
                totalPrize, totalCost, netProfit, roi,
                avgMatches: parseFloat(data.avg_matches).toFixed(2)
            };
        }
        
        for (const strategy of strategies) {
            const result = await pool.query(
                'SELECT COUNT(*) as total_bets, COALESCE(SUM(prize), 0) as total_prize, COALESCE(AVG(matches), 0) as avg_matches FROM bets WHERE strategy = $1 AND type = $2 AND result_numbers IS NOT NULL',
                [strategy, 'manual']
            );
            const data = result.rows[0];
            const totalCost = parseInt(data.total_bets) * PRICING.betCost;
            const totalPrize = parseFloat(data.total_prize);
            const netProfit = totalPrize - totalCost;
            const roi = totalCost > 0 ? ((netProfit / totalCost) * 100).toFixed(2) : '0.00';
            stats.manual[strategy] = {
                totalBets: parseInt(data.total_bets),
                totalPrize, totalCost, netProfit, roi,
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
        const lastResult = await pool.query('SELECT date, contest_number, balance FROM results ORDER BY date DESC LIMIT 1');
        
        // Saldo total de todos os resultados
        const totalBalanceQuery = await pool.query('SELECT COALESCE(SUM(balance), 0) as total_balance FROM results');
        const totalBalance = parseFloat(totalBalanceQuery.rows[0].total_balance);
        
        res.json({
            status: 'active',
            pendingBets: parseInt(pending.rows[0].count),
            lastBetDate: lastBet.rows[0]?.date || null,
            lastResultDate: lastResult.rows[0]?.date || null,
            lastContest: lastResult.rows[0]?.contest_number || null,
            lastBalance: lastResult.rows[0]?.balance || 0,
            totalBalance: totalBalance
        });
    } catch { res.status(500).json({ error: 'Erro' }); }
});

app.get('/api/pricing', (req, res) => res.json(PRICING));

app.post('/api/insert-result', async (req, res) => {
    try {
        const { contestNumber, numbers, date } = req.body;
        
        console.log('✍️ INSERÇÃO MANUAL DE RESULTADO');
        
        if (!contestNumber || !numbers || numbers.length !== 15) {
            return res.status(400).json({ 
                success: false, 
                error: 'Dados inválidos. Precisa de contestNumber e 15 números únicos.' 
            });
        }
        
        if (new Set(numbers).size !== 15) {
            return res.status(400).json({ 
                success: false, 
                error: 'Os 15 números devem ser únicos!' 
            });
        }
        
        const resultData = {
            contestNumber: parseInt(contestNumber),
            numbers: numbers.map(n => parseInt(n)).sort((a, b) => a - b),
            date: date || getTodayBrazil(),
            prizes: PRIZE_VALUES,
            source: 'manual'
        };
        
        const checkResult = await checkBetsWithResult(resultData);
        
        if (checkResult.success) {
            res.json({ 
                success: true, 
                message: `✅ ${checkResult.checked} apostas conferidas!`,
                checked: checkResult.checked,
                totalPrize: checkResult.totalPrize,
                balance: checkResult.balance
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: checkResult.error || 'Erro ao conferir apostas' 
            });
        }
    } catch (error) {
        console.error('❌ Erro:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/generate-bets', async (req, res) => {
    try {
        await generateDailyBets();
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
        const today = getTodayBrazil();
        const generated = [];
        
        for (const [name, count] of Object.entries(distribution)) {
            if (count > 0 && strategies[name]) {
                for (let i = 0; i < count; i++) {
                    const numbers = await strategies[name]();
                    const result = await pool.query(
                        'INSERT INTO bets (strategy, numbers, date, type) VALUES ($1, $2, $3, $4) RETURNING *',
                        [name, numbers, today, 'manual']
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

// Gera 6 apostas TODO DIA às 00:00 BRT
cron.schedule('0 0 * * *', () => {
    console.log('⏰ [CRON] Geração diária de 6 apostas (00:00 BRT)');
    generateDailyBets();
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
            console.log(`📅 Hoje (Brasil): ${getTodayBrazil()}`);
            console.log('');
            console.log('⏰ CRON JOBS:');
            console.log('   📅 Gerar 6 apostas: TODO DIA 00:00 BRT');
            console.log('');
            console.log('💰 VALORES DE PRÊMIOS:');
            console.log('   15 acertos: R$ 850.000,00 (média)');
            console.log('   14 acertos: R$ 1.400,00 (média)');
            console.log('   13 acertos: R$ 35,00 (fixo)');
            console.log('   12 acertos: R$ 14,00 (fixo)');
            console.log('   11 acertos: R$ 7,00 (fixo)');
            console.log('   10 ou menos: R$ 0,00 (prejuízo)');
            console.log('');
            console.log('💵 Custo por aposta: R$ 3,50');
            console.log('═══════════════════════════════════════');
            console.log('');
        });
    } catch (error) {
        console.error('❌ Erro ao iniciar:', error);
        process.exit(1);
    }
}

startServer();
