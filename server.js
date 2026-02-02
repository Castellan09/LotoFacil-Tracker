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
                bets_checked INTEGER DEFAULT 0,
                prize_11 DECIMAL(10, 2) DEFAULT 0,
                prize_12 DECIMAL(10, 2) DEFAULT 0,
                prize_13 DECIMAL(10, 2) DEFAULT 0,
                prize_14 DECIMAL(10, 2) DEFAULT 0,
                prize_15 DECIMAL(10, 2) DEFAULT 0,
                source VARCHAR(50) DEFAULT 'api',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            DO $$ BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='results' AND column_name='source') THEN
                    ALTER TABLE results ADD COLUMN source VARCHAR(50) DEFAULT 'api';
                END IF;
            END $$;
        `);

        console.log('✅ Database OK');
    } catch (error) {
        console.error('❌ Database error:', error);
    }
}

const PRICING = { betCost: 3.50 };

function getTodayBrazil() {
    const now = new Date();
    const brazilTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
    return brazilTime.toISOString().split('T')[0];
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
    console.log('🎲 GERANDO APOSTAS DIÁRIAS');
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
    console.log('✅ APOSTAS DIÁRIAS GERADAS!');
    console.log('═══════════════════════════════════════');
    console.log('');
}

// ==================== RESULT FETCHING (MÚLTIPLAS FONTES) ====================

async function tryFetchFromGoogle() {
    console.log('🔍 Fonte 1: Tentando Google...');
    try {
        const response = await fetch('https://www.google.com/search?q=resultado+lotofacil+de+hoje', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html',
                'Accept-Language': 'pt-BR,pt;q=0.9'
            },
            timeout: 10000
        });
        
        if (!response.ok) {
            console.log(`❌ Google retornou: ${response.status}`);
            return null;
        }
        
        const html = await response.text();
        
        // Tenta extrair números do HTML do Google
        const numberRegex = /\b(0[1-9]|1[0-9]|2[0-5])\b/g;
        const matches = html.match(numberRegex);
        
        if (matches && matches.length >= 15) {
            const numbers = [...new Set(matches.slice(0, 15).map(n => parseInt(n)))];
            if (numbers.length === 15) {
                console.log(`✅ Google: Encontrado! [${numbers.join(', ')}]`);
                
                // Tenta extrair concurso
                const contestRegex = /concurso[^\d]*(\d{4})/i;
                const contestMatch = html.match(contestRegex);
                const contestNumber = contestMatch ? parseInt(contestMatch[1]) : null;
                
                return {
                    contestNumber: contestNumber || 9999,
                    numbers: numbers.sort((a, b) => a - b),
                    date: getTodayBrazil(),
                    prizes: { 11: 6, 12: 12, 13: 30, 14: 1500, 15: 1000000 },
                    source: 'google'
                };
            }
        }
        
        console.log('❌ Google: Não encontrou números válidos');
        return null;
    } catch (error) {
        console.log(`❌ Google erro: ${error.message}`);
        return null;
    }
}

async function tryFetchFromCaixa() {
    console.log('🔍 Fonte 2: Tentando API Caixa...');
    try {
        const response = await fetch('https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil', {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json'
            },
            timeout: 10000
        });
        
        if (!response.ok) {
            console.log(`❌ API Caixa retornou: ${response.status}`);
            return null;
        }
        
        const data = await response.json();
        console.log(`✅ API Caixa: Concurso ${data.numero}`);
        
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
            prizes: prizes,
            source: 'api_caixa'
        };
    } catch (error) {
        console.log(`❌ API Caixa erro: ${error.message}`);
        return null;
    }
}

async function tryFetchFromLoteriasAPI() {
    console.log('🔍 Fonte 3: Tentando Loterias.com.br...');
    try {
        const response = await fetch('https://loteriascaixa-api.herokuapp.com/api/lotofacil/latest', {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json'
            },
            timeout: 10000
        });
        
        if (!response.ok) {
            console.log(`❌ Loterias API retornou: ${response.status}`);
            return null;
        }
        
        const data = await response.json();
        console.log(`✅ Loterias API: Concurso ${data.concurso}`);
        
        return {
            contestNumber: parseInt(data.concurso),
            numbers: data.dezenas.map(n => parseInt(n)),
            date: data.data,
            prizes: { 11: 6, 12: 12, 13: 30, 14: 1500, 15: 1500000 },
            source: 'loterias_api'
        };
    } catch (error) {
        console.log(`❌ Loterias API erro: ${error.message}`);
        return null;
    }
}

async function fetchLatestResult() {
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('🔍 BUSCANDO RESULTADO (MÚLTIPLAS FONTES)');
    console.log('═══════════════════════════════════════');
    
    // Tenta todas as fontes em ordem
    const sources = [
        tryFetchFromGoogle,
        tryFetchFromCaixa,
        tryFetchFromLoteriasAPI
    ];
    
    for (const sourceFn of sources) {
        const result = await sourceFn();
        if (result) {
            console.log(`✅ SUCESSO! Fonte: ${result.source}`);
            console.log(`📊 Concurso: ${result.contestNumber}`);
            console.log(`🎲 Números: [${result.numbers.join(', ')}]`);
            console.log('═══════════════════════════════════════');
            console.log('');
            return result;
        }
    }
    
    console.log('❌ TODAS AS FONTES FALHARAM');
    console.log('💡 Use o botão "INSERIR RESULTADO" no site');
    console.log('═══════════════════════════════════════');
    console.log('');
    return null;
}

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
        
        if (existing.rows.length === 0) {
            console.log('🆕 Salvando novo resultado...');
            await pool.query(
                `INSERT INTO results (
                    contest_number, numbers, date,
                    prize_11, prize_12, prize_13, prize_14, prize_15, source
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    resultData.contestNumber,
                    resultData.numbers,
                    resultData.date,
                    resultData.prizes[11],
                    resultData.prizes[12],
                    resultData.prizes[13],
                    resultData.prizes[14],
                    resultData.prizes[15],
                    resultData.source
                ]
            );
            console.log('✅ Resultado salvo!');
        } else {
            console.log(`ℹ️ Concurso ${resultData.contestNumber} já existe`);
        }
        
        const pending = await pool.query(
            'SELECT * FROM bets WHERE result_numbers IS NULL ORDER BY date ASC'
        );
        
        if (pending.rows.length === 0) {
            console.log('ℹ️ Sem apostas pendentes');
            console.log('═══════════════════════════════════════');
            console.log('');
            return { success: true, checked: 0, totalPrize: 0 };
        }
        
        console.log(`📋 ${pending.rows.length} apostas pendentes`);
        console.log('');
        console.log('Conferindo...');
        console.log('─────────────────────────────────────────');
        
        let totalPrize = 0;
        let checkedCount = 0;
        
        for (const bet of pending.rows) {
            const matches = bet.numbers.filter(num => 
                resultData.numbers.includes(num)
            ).length;
            
            const prize = resultData.prizes[matches] || 0;
            totalPrize += prize;
            
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
        
        await pool.query(
            'UPDATE results SET total_prize = $1, bets_checked = $2 WHERE contest_number = $3',
            [totalPrize, checkedCount, resultData.contestNumber]
        );
        
        console.log('─────────────────────────────────────────');
        console.log('');
        console.log(`✅ ${checkedCount} APOSTAS CONFERIDAS!`);
        console.log(`💰 Prêmio: R$ ${totalPrize.toFixed(2)}`);
        console.log(`💵 Custo: R$ ${(checkedCount * PRICING.betCost).toFixed(2)}`);
        console.log(`📊 Saldo: R$ ${(totalPrize - (checkedCount * PRICING.betCost)).toFixed(2)}`);
        console.log('═══════════════════════════════════════');
        console.log('');
        
        return { success: true, checked: checkedCount, totalPrize: totalPrize };
    } catch (error) {
        console.error('❌ ERRO:', error);
        console.log('═══════════════════════════════════════');
        console.log('');
        return { success: false, error: error.message };
    }
}

async function checkPendingBets() {
    const result = await fetchLatestResult();
    if (result) {
        await checkBetsWithResult(result);
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

app.get('/api/test-fetch', async (req, res) => {
    console.log('🧪 TESTE MANUAL SOLICITADO');
    const result = await fetchLatestResult();
    if (result) {
        res.json({ success: true, data: result });
    } else {
        res.status(500).json({ success: false, message: 'Nenhuma fonte funcionou' });
    }
});

app.post('/api/force-check', async (req, res) => {
    console.log('🔄 CHECAGEM FORÇADA');
    await checkPendingBets();
    res.json({ success: true });
});

app.post('/api/insert-result', async (req, res) => {
    try {
        const { contestNumber, numbers, date, prizes } = req.body;
        
        console.log('✍️ INSERÇÃO MANUAL');
        
        if (!contestNumber || !numbers || numbers.length !== 15) {
            return res.status(400).json({ 
                success: false, 
                error: 'Dados inválidos' 
            });
        }
        
        const resultData = {
            contestNumber: parseInt(contestNumber),
            numbers: numbers.map(n => parseInt(n)),
            date: date || getTodayBrazil(),
            prizes: prizes || { 11: 6, 12: 12, 13: 30, 14: 1500, 15: 1000000 },
            source: 'manual'
        };
        
        const checkResult = await checkBetsWithResult(resultData);
        
        res.json({ 
            success: true, 
            message: `${checkResult.checked} apostas conferidas!`,
            checked: checkResult.checked,
            totalPrize: checkResult.totalPrize
        });
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

cron.schedule('0 0 * * *', () => {
    console.log('⏰ [CRON] Geração diária');
    generateDailyBets();
}, { timezone: "America/Sao_Paulo" });

cron.schedule('0 * * * *', () => {
    console.log('⏰ [CRON] Tentando conferir (múltiplas fontes)');
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
            console.log(`📅 Hoje: ${getTodayBrazil()}`);
            console.log('');
            console.log('⏰ CRON:');
            console.log('   📅 Gerar: TODO DIA 00:00 BRT');
            console.log('   🔍 Conferir: A CADA 1 HORA (múltiplas fontes)');
            console.log('');
            console.log('🔍 FONTES DE DADOS:');
            console.log('   1. Google (web scraping)');
            console.log('   2. API Caixa');
            console.log('   3. Loterias API alternativa');
            console.log('   4. Inserção manual (fallback)');
            console.log('');
            console.log('💰 Custo: R$ 3,50/aposta');
            console.log('═══════════════════════════════════════');
            console.log('');
        });
    } catch (error) {
        console.error('❌ Erro:', error);
        process.exit(1);
    }
}

startServer();
