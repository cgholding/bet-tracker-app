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
- Em apostas abertas, use `Cashout atual Over/Under` para monitorar quanto a Bet365 está pagando se encerrar agora.
- Ao fechar, marque o resultado como `Ganhou`, `Perdeu`, `Cashout` ou `Anulada` e preencha `Retorno/Cash` quando for cashout.
- A aba `Saldo do Dia` controla banca inicial/final e concilia o resultado do dia.
- A `Dashboard` mostra lucro fechado, dinheiro em jogo, P/L se cashar agora, ROI, reds, cashouts, duplos greens, gráfico diário e exposição por conta.
- A tela de login usa Supabase Auth.
- A aba `Config` tem backup JSON e sincronização por conta no Supabase.

## Supabase

1. Crie um projeto no Supabase.
2. Rode o SQL de `supabase/schema.sql` no SQL Editor.
3. Em `Authentication > URL Configuration`, use `https://movidafit.site` como Site URL.
4. O app já está configurado com o projeto `maenndpjseglihhmvils`.
5. Cada usuário cria login próprio e fica com um snapshot separado por `auth.uid()`.
6. Use `Salvar agora na nuvem` para salvar o snapshot atual.
7. Use `Carregar minha nuvem` em outro navegador/dispositivo para recuperar o mesmo snapshot.

## Próximo passo

Depois, dá para evoluir para perfis, convites e permissões de administrador.
