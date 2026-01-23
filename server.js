// server.js - Backend Node.js
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const cron = require('node-cron');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do banco de dados PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Dados históricos de frequência
const FREQUENCY_DATA = [
  { num: 20, freq: 2246 }, { num: 10, freq: 2234 }, { num: 25, freq: 2233 },
  { num: 11, freq: 2208 }, { num: 13, freq: 2191 }, { num: 24, freq: 2185 },
  { num: 14, freq: 2180 }, { num: 1, freq: 2179 }, { num: 4, freq: 2175 },
  { num: 12, freq: 2168 }, { num: 3, freq: 2167 }, { num: 2, freq: 2155 },
  { num: 5, freq: 2154 }, { num: 22, freq: 2154 }, { num: 15, freq: 2146 },
  { num: 9, freq: 2145 }, { num: 18, freq: 2144 }, { num: 19, freq: 2143 },
  { num: 21, freq: 2136 }, { num: 7, freq: 2123 }, { num: 17, freq: 2121 },
  { num: 6, freq: 2107 }, { num: 23, freq: 2102 }, { num: 8, freq: 2087 },
  { num: 16, freq: 2057 }
];

// Valor real da aposta Lotofácil (15 números)
const BET_COST = 3.50;

// Tabela de prêmios REAIS da Lotofácil
const PRIZE_TABLE = { 
  15: 1500000, // Variável - média histórica
  14: 1500,    // Variável - média histórica
  13: 30,      // Fixo
  12: 12,      // Fixo
  11: 6        // Fixo
};

const STRATEGIES = ['weighted', 'balanced', 'moderate', 'distributed', 'intelligent', 'random'];

// Funções de geração de apostas
const shuffle = (array) => {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const generateWeighted = () => {
  const weighted = [];
  FREQUENCY_DATA.forEach(({ num, freq }) => {
    const weight = Math.floor(freq / 100);
    for (let i = 0; i < weight; i++) weighted.push(num);
  });
  return [...new Set(shuffle(weighted))].slice(0, 15).sort((a, b) => a - b);
};

const generateBalanced = () => {
  const top12 = FREQUENCY_DATA.slice(0, 12).map(d => d.num);
  const bottom13 = FREQUENCY_DATA.slice(12).map(d => d.num);
  const middle = FREQUENCY_DATA.slice(6, 19).map(d => d.num);
  const selected = [
    ...shuffle(top12).slice(0, 8),
    ...shuffle(bottom13).slice(0, 5),
    ...shuffle(middle).slice(0, 2)
  ];
  return [...new Set(selected)].sort((a, b) => a - b).slice(0, 15);
};

const generateModerate = () => {
  const moderate = FREQUENCY_DATA.slice(5, 20).map(d => d.num);
  return shuffle(moderate).slice(0, 15).sort((a, b) => a - b);
};

const generateDistributed = () => {
  const ranges = [[1, 5], [6, 10], [11, 15], [16, 20], [21, 25]];
  const selected = [];
  ranges.forEach(([min, max]) => {
    const rangeNums = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    const count = Math.floor(Math.random() * 2) + 2;
    selected.push(...shuffle(rangeNums).slice(0, count));
  });
  return [...new Set(selected)].sort((a, b) => a - b).slice(0, 15);
};

const generateIntelligent = () => {
  const top15 = FREQUENCY_DATA.slice(0, 15).map(d => d.num);
  const rest = FREQUENCY_DATA.slice(15).map(d => d.num);
  let selected = [...shuffle(top15).slice(0, 9), ...shuffle(rest).slice(0, 6)];
  const even = selected.filter(n => n % 2 === 0);
  if (even.length < 6) {
    const moreEven = Array.from({ length: 25 }, (_, i) => i + 1)
      .filter(n => n % 2 === 0 && !selected.includes(n));
    selected.push(...shuffle(moreEven).slice(0, 6 - even.length));
  }
  return [...new Set(selected)].sort((a, b) => a - b).slice(0, 15);
};

const generateRandom = () => {
  const allNums = Array.from({ length: 25 }, (_, i) => i + 1);
  return shuffle(allNums).slice(0, 15).sort((a, b) => a - b);
};

const GENERATORS = {
  weighted: generateWeighted,
  balanced: generateBalanced,
  moderate: generateModerate,
  distributed: generateDistributed,
  intelligent: generateIntelligent,
  random: generateRandom
};

// Inicializar banco de dados
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS bets (
        id SERIAL PRIMARY KEY,
        strategy VARCHAR(50) NOT NULL,
        numbers INTEGER[] NOT NULL,
        date DATE NOT NULL,
        result_numbers INTEGER[],
        matches INTEGER,
        prize DECIMAL(10, 2) DEFAULT 0,
        contest_number VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS results (
        id SERIAL PRIMARY KEY,
        contest_number VARCHAR(20) UNIQUE NOT NULL,
        numbers INTEGER[] NOT NULL,
        date DATE NOT NULL,
        total_prize DECIMAL(10, 2) DEFAULT 0,
        bets_checked INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bets_date ON bets(date);
      CREATE INDEX IF NOT EXISTS idx_bets_strategy ON bets(strategy);
      CREATE INDEX IF NOT EXISTS idx_results_contest ON results(contest_number);
    `);

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
  } finally {
    client.release();
  }
}

// Buscar resultado da API
async function fetchLatestResult() {
  const APIs = [
    'https://loteriascaixa-api.herokuapp.com/api/lotofacil/latest',
    'https://api.guidi.dev.br/loteria/lotofacil/ultimo'
  ];

  for (const apiUrl of APIs) {
    try {
      const response = await fetch(apiUrl);
      if (!response.ok) continue;
      
      const data = await response.json();
      let contest, numbers, date;
      
      if (data.concurso || data.numero) {
        contest = (data.concurso || data.numero).toString();
        numbers = data.dezenas || data.listaDezenas || data.dezenasSorteadasOrdemSorteio || [];
        date = data.dataApuracao || data.data || new Date().toISOString().split('T')[0];
      }
      
      if (numbers && numbers.length === 15) {
        const nums = numbers.map(n => typeof n === 'string' ? parseInt(n) : n);
        return { contest, numbers: nums, date };
      }
    } catch (error) {
      console.log(`Erro na API ${apiUrl}:`, error.message);
      continue;
    }
  }
  
  return null;
}

// Gerar apostas diárias
async function generateDailyBets() {
  const client = await pool.connect();
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Verificar se já tem apostas hoje
    const existingBets = await client.query(
      'SELECT COUNT(*) FROM bets WHERE date = $1',
      [today]
    );

    if (parseInt(existingBets.rows[0].count) > 0) {
      console.log(`✓ Apostas já geradas para ${today}`);
      return;
    }

    // Gerar uma aposta para cada estratégia
    for (const strategy of STRATEGIES) {
      const numbers = GENERATORS[strategy]();
      await client.query(
        'INSERT INTO bets (strategy, numbers, date) VALUES ($1, $2, $3)',
        [strategy, numbers, today]
      );
      console.log(`✓ Aposta gerada: ${strategy} - [${numbers.join(', ')}]`);
    }

    console.log(`🎲 ${STRATEGIES.length} apostas geradas para ${today}`);
  } catch (error) {
    console.error('❌ Erro ao gerar apostas:', error);
  } finally {
    client.release();
  }
}

// Conferir apostas pendentes
async function checkPendingBets() {
  const client = await pool.connect();
  try {
    console.log('🔍 Verificando novos resultados...');
    
    const result = await fetchLatestResult();
    if (!result) {
      console.log('⚠️ Nenhum resultado disponível');
      return;
    }

    const { contest, numbers, date } = result;

    // Verificar se já conferimos este concurso
    const existing = await client.query(
      'SELECT id FROM results WHERE contest_number = $1',
      [contest]
    );

    if (existing.rows.length > 0) {
      console.log(`✓ Concurso ${contest} já conferido`);
      return;
    }

    // Buscar apostas pendentes
    const pendingBets = await client.query(
      'SELECT * FROM bets WHERE date <= $1 AND result_numbers IS NULL',
      [date]
    );

    if (pendingBets.rows.length === 0) {
      console.log('✓ Nenhuma aposta pendente');
      return;
    }

    let totalPrize = 0;

    // Conferir cada aposta
    for (const bet of pendingBets.rows) {
      const matches = bet.numbers.filter(n => numbers.includes(n)).length;
      const prize = PRIZE_TABLE[matches] || 0;
      totalPrize += prize;

      await client.query(
        'UPDATE bets SET result_numbers = $1, matches = $2, prize = $3, contest_number = $4 WHERE id = $5',
        [numbers, matches, prize, contest, bet.id]
      );

      console.log(`  ✓ ${bet.strategy}: ${matches} acertos - R$ ${prize.toFixed(2)}`);
    }

    // Registrar resultado
    await client.query(
      'INSERT INTO results (contest_number, numbers, date, total_prize, bets_checked) VALUES ($1, $2, $3, $4, $5)',
      [contest, numbers, date, totalPrize, pendingBets.rows.length]
    );

    console.log(`🎉 Concurso ${contest} conferido! ${pendingBets.rows.length} apostas - R$ ${totalPrize.toFixed(2)}`);
  } catch (error) {
    console.error('❌ Erro ao conferir apostas:', error);
  } finally {
    client.release();
  }
}

// API Endpoints
app.get('/api/bets', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM bets ORDER BY date DESC, created_at DESC LIMIT 1000'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/results', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM results ORDER BY date DESC LIMIT 100'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const stats = {};
    
    for (const strategy of STRATEGIES) {
      const result = await pool.query(`
        SELECT 
          COUNT(*) as total_bets,
          COALESCE(SUM(prize), 0) as total_prize,
          COALESCE(AVG(matches), 0) as avg_matches,
          COUNT(*) FILTER (WHERE matches = 11) as matches_11,
          COUNT(*) FILTER (WHERE matches = 12) as matches_12,
          COUNT(*) FILTER (WHERE matches = 13) as matches_13,
          COUNT(*) FILTER (WHERE matches = 14) as matches_14,
          COUNT(*) FILTER (WHERE matches = 15) as matches_15
        FROM bets 
        WHERE strategy = $1 AND result_numbers IS NOT NULL
      `, [strategy]);

      const data = result.rows[0];
      const totalCost = parseInt(data.total_bets) * BET_COST;
      const totalPrize = parseFloat(data.total_prize);

      stats[strategy] = {
        totalBets: parseInt(data.total_bets),
        totalPrize: totalPrize,
        totalCost: totalCost,
        netProfit: totalPrize - totalCost,
        avgMatches: parseFloat(data.avg_matches).toFixed(2),
        roi: totalCost > 0 ? ((totalPrize - totalCost) / totalCost * 100).toFixed(2) : 0,
        matchDistribution: {
          11: parseInt(data.matches_11),
          12: parseInt(data.matches_12),
          13: parseInt(data.matches_13),
          14: parseInt(data.matches_14),
          15: parseInt(data.matches_15)
        }
      };
    }

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/generate-bets', async (req, res) => {
  try {
    await generateDailyBets();
    res.json({ success: true, message: 'Apostas geradas com sucesso' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/check-results', async (req, res) => {
  try {
    await checkPendingBets();
    res.json({ success: true, message: 'Resultados verificados' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/status', async (req, res) => {
  try {
    const pendingBets = await pool.query(
      'SELECT COUNT(*) FROM bets WHERE result_numbers IS NULL'
    );
    const totalBets = await pool.query('SELECT COUNT(*) FROM bets');
    const totalResults = await pool.query('SELECT COUNT(*) FROM results');
    
    res.json({
      status: 'running',
      pendingBets: parseInt(pendingBets.rows[0].count),
      totalBets: parseInt(totalBets.rows[0].count),
      totalResults: parseInt(totalResults.rows[0].count),
      betCost: BET_COST,
      lastCheck: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Novo endpoint: Calculadora de investimento
app.post('/api/calculate-investment', async (req, res) => {
  try {
    const { amount, strategies } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valor inválido' });
    }

    // Calcular quantas apostas por estratégia
    const totalStrategies = strategies ? Object.keys(strategies).length : STRATEGIES.length;
    const maxBetsTotal = Math.floor(amount / BET_COST);
    const betsPerStrategy = Math.floor(maxBetsTotal / totalStrategies);
    const actualTotal = betsPerStrategy * totalStrategies;
    const actualCost = actualTotal * BET_COST;
    const change = amount - actualCost;

    const distribution = {};
    const selectedStrategies = strategies || STRATEGIES.reduce((acc, s) => ({ ...acc, [s]: true }), {});
    
    Object.keys(selectedStrategies).forEach(strategy => {
      if (selectedStrategies[strategy]) {
        distribution[strategy] = betsPerStrategy;
      }
    });

    res.json({
      requestedAmount: parseFloat(amount),
      betCost: BET_COST,
      maxPossibleBets: maxBetsTotal,
      strategiesCount: totalStrategies,
      betsPerStrategy: betsPerStrategy,
      totalBets: actualTotal,
      actualCost: parseFloat(actualCost.toFixed(2)),
      change: parseFloat(change.toFixed(2)),
      distribution
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Novo endpoint: Informações de preço
app.get('/api/pricing', (req, res) => {
  res.json({
    betCost: BET_COST,
    prizeTable: PRIZE_TABLE,
    currency: 'BRL'
  });
});

// Agendar tarefas automáticas
function scheduleTasks() {
  // Gerar apostas todo dia às 00:00 (meia-noite)
  cron.schedule('0 0 * * *', () => {
    console.log('⏰ Executando geração diária de apostas...');
    generateDailyBets();
  }, {
    timezone: 'America/Sao_Paulo'
  });

  // Verificar resultados a cada 1 hora
  cron.schedule('0 * * * *', () => {
    console.log('⏰ Executando verificação de resultados...');
    checkPendingBets();
  }, {
    timezone: 'America/Sao_Paulo'
  });

  console.log('⏰ Cron jobs agendados:');
  console.log('  - Geração de apostas: Diariamente às 00:00');
  console.log('  - Verificação de resultados: A cada 1 hora');
}

// Inicializar servidor
async function startServer() {
  try {
    await initDatabase();
    
    // Gerar apostas e verificar resultados na inicialização
    await generateDailyBets();
    await checkPendingBets();
    
    // Agendar tarefas
    scheduleTasks();
    
    app.listen(PORT, () => {
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
      console.log(`🌐 API disponível em: http://localhost:${PORT}`);
      console.log(`✅ Sistema automático ativo 24/7`);
    });
  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }
}

startServer();
