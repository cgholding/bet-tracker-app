# Duplo Green Tracker

App local para controlar apostas da estratégia de finalizações com Substituição+.

## Como rodar localmente

```bash
python3 -m http.server 8787
```

Depois abra:

```text
http://127.0.0.1:8787
```

## Como funciona

- Os dados ficam salvos no navegador via `localStorage`.
- A aba `Apostas` registra over, under, odds, stakes, cashout, substituição e resultado.
- A aba `Saldo do Dia` controla banca inicial/final e concilia o resultado do dia.
- A `Dashboard` mostra lucro, ROI, reds, cashouts, duplos greens e gráfico diário.

## Próximo passo

Quando for subir para Vercel, dá para manter o app estático primeiro. Depois, trocamos o armazenamento local por Supabase.
