# 🎯 Lotofácil Tracker - Sistema Automático 24/7

Sistema completo de tracking de apostas da Lotofácil que roda automaticamente no servidor.

## ✨ Funcionalidades

- 🎲 **Gera automaticamente** 1 aposta por estratégia todo dia às 00:00
- 🔍 **Verifica resultados** automaticamente a cada 1 hora
- 💾 **Guarda tudo** permanentemente no banco PostgreSQL
- 📊 **Dashboard completo** com estatísticas e rankings
- 🚀 **Roda 24/7** sem precisar deixar nada aberto

## 🚀 Quick Start

### Deploy no Railway (Recomendado)

1. Fork este repositório
2. Acesse [Railway.app](https://railway.app)
3. New Project → Deploy from GitHub
4. Adicione PostgreSQL
5. Pronto! Sistema rodando 24/7

Veja o [GUIA-DEPLOY.md](../GUIA-DEPLOY.md) para instruções completas.

## 📋 Requisitos

- Node.js 18+
- PostgreSQL
- APIs Lotofácil (gratuitas)

## 🛠️ Instalação Local

```bash
npm install
cp .env.example .env
# Edite .env com suas credenciais
npm start
```

## 📡 API Endpoints

- `GET /api/bets` - Lista apostas
- `GET /api/results` - Lista resultados
- `GET /api/stats` - Estatísticas
- `GET /api/status` - Status do sistema

## 📊 Estratégias Implementadas

1. 📊 Frequência Ponderada
2. ⚖️ Mix Equilibrado
3. 🎯 Evitar Extremos
4. 📐 Distribuição Uniforme
5. 🧠 Inteligente
6. 🎲 Aleatório Puro

## 📄 Licença

MIT
