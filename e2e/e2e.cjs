// Teste de ponta a ponta: abre o sistema no navegador e percorre o fluxo principal.
// Uso: com o servidor rodando (iniciar.sh), execute:  node e2e/e2e.cjs [url] [pasta-de-capturas]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.argv[2] || 'http://127.0.0.1:8000/';
const SHOTS = process.argv[3] || null;
let step = 0;

function ok(cond, msg) {
  if (!cond) throw new Error('FALHOU: ' + msg);
  console.log('  ✓ ' + msg);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = async (name) => {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${String(++step).padStart(2, '0')}-${name}.png`), fullPage: true });
  };
  const nav = (label) => page.locator('nav').getByRole('button', { name: label }).click();
  const confirmModal = (label) => page.locator('.modal-foot').getByRole('button', { name: label }).click();

  console.log('1. Estrutura inicial');
  await page.goto(URL);
  await page.waitForSelector('text=Painel');
  ok(await page.locator('.stat', { hasText: 'Turmas – Manhã' }).locator('.stat-value').innerText() === '15', '15 turmas na manhã');
  ok(await page.locator('.stat', { hasText: 'Turmas – Tarde' }).locator('.stat-value').innerText() === '15', '15 turmas na tarde');
  ok(await page.getByText('quantidade de turmas pendente').count() >= 2, 'pendências de 2º e 3º anos da tarde exibidas');
  await shot('painel-inicial');
  await nav('Cadastro de turmas');
  await page.waitForSelector('text=Informar quantidade');
  await shot('turmas');
  await nav('Cadastro de períodos');
  await shot('periodos');

  console.log('2. Carregar demonstração (fictícia)');
  await nav('Configurações e backups');
  await page.getByRole('tab', { name: 'Outras opções' }).click();
  await page.getByRole('button', { name: 'Carregar demonstração' }).click();
  await confirmModal('Carregar demonstração');
  await page.waitForSelector('.demo-banner');
  ok(await page.locator('.demo-banner').isVisible(), 'aviso de dados fictícios visível');

  console.log('3. Cadastros');
  await nav('Cadastro de professores');
  await page.waitForSelector('text=Atribuição de aulas');
  await shot('professores');
  await nav('Matriz curricular');
  await page.waitForSelector('text=Matriz curricular –');
  await shot('matriz');
  await nav('Cargas horárias');
  await page.getByRole('button', { name: 'Demonstrativo' }).first().click();
  await shot('cargas');
  await nav('H.A., CCH e HL');
  await shot('atividades');
  await nav('Disponibilidade');
  await shot('disponibilidade');

  console.log('4. Montagem automática');
  await nav('Montagem automática');
  await page.waitForSelector('text=Motor de otimização conectado', { timeout: 15000 });
  ok(true, 'motor de otimização conectado');
  // somente 2 prioridades, 20 s cada, para o teste ser rápido
  for (const label of ['Menos dias trabalhados', 'Melhor distribuição das disciplinas']) {
    const cb = page.locator('label.check', { hasText: label }).locator('input');
    if (await cb.isChecked()) await cb.uncheck();
  }
  const tl = page.getByLabel('Tempo por grade (segundos)');
  await tl.fill('20');
  await tl.press('Enter');
  await shot('montagem-opcoes');
  await page.getByRole('button', { name: '⚙ Gerar grade(s)' }).click();
  if (await page.locator('.modal').count()) await confirmModal('Gerar mesmo assim');
  await page.waitForSelector('text=Comparação das grades geradas', { timeout: 180000 });
  const badges = await page.locator('.compare tbody tr').count();
  ok(badges === 2, '2 grades geradas');
  ok(await page.locator('.compare .badge.erro').count() === 0, 'nenhuma grade com conflito');
  ok(await page.locator('.compare', { hasText: 'Sem conflitos' }).count() === 1, 'grades sem conflitos');
  await page.locator('details summary').first().click();
  await shot('montagem-resultados');

  console.log('5. Grade por turma: arrastar, desfazer, bloquear');
  await nav('Grade por turma');
  await page.waitForSelector('table.sched');
  await shot('grade-turma');
  ok(await page.locator('.cell.conflict').count() === 0, 'nenhuma célula em conflito');
  const before = await page.locator('table.sched').innerText();
  // tenta arrastar cada aula até achar um destino válido (verde)
  const cells = page.locator('table.sched .cell[draggable="true"]');
  let moved = false;
  for (let i = 0; i < Math.min(await cells.count(), 15) && !moved; i++) {
    const src = cells.nth(i);
    await src.dispatchEvent('dragstart', { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
    await page.waitForTimeout(150);
    const target = page.locator('table.sched .cell.drop-ok').first();
    if (await target.count()) {
      const dt = await page.evaluateHandle(() => new DataTransfer());
      await src.dispatchEvent('dragstart', { dataTransfer: dt });
      await page.waitForTimeout(100);
      await page.locator('table.sched .cell.drop-ok').first().dispatchEvent('drop', { dataTransfer: dt });
      moved = true;
    } else {
      await src.dispatchEvent('dragend');
    }
  }
  ok(moved, 'aula arrastada para um horário válido');
  await page.waitForTimeout(300);
  const after = await page.locator('table.sched').innerText();
  ok(before !== after, 'grade alterada após arrastar');
  ok(await page.locator('.cell.conflict').count() === 0, 'movimento não criou conflitos');
  await page.getByRole('button', { name: '↶ Desfazer' }).click();
  await page.waitForTimeout(300);
  ok((await page.locator('table.sched').innerText()) === before, 'desfazer restaura a grade');
  await page.getByRole('button', { name: '↷ Refazer' }).click();
  await page.waitForTimeout(300);
  ok((await page.locator('table.sched').innerText()) === after, 'refazer reaplica a alteração');
  await page.locator('table.sched .cell[draggable="true"]').first().click();
  await page.getByRole('button', { name: /Bloquear \(manter/ }).click();
  await page.waitForTimeout(200);
  ok(await page.locator('table.sched .cell.locked').count() === 1, 'aula bloqueada');
  // tentativa de colocar em horário que gera conflito: inserir via editor uma aula de outro professor ocupado
  await shot('grade-turma-editada');

  console.log('6. Grade por professor e geral');
  await nav('Grade por professor');
  await page.waitForSelector('text=Total de aulas');
  await shot('grade-professor');
  await nav('Grade geral');
  await page.waitForSelector('table.overview');
  await shot('grade-geral');

  console.log('7. Relatórios e exportações');
  await nav('Relatórios');
  await page.waitForSelector('text=Grade semanal por turma');
  for (const [btn, ext] of [['PDF', '.pdf'], ['Excel', '.xlsx'], ['CSV', '.csv']]) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.card-actions').getByRole('button', { name: btn, exact: true }).click()]);
    ok(dl.suggestedFilename().endsWith(ext), `exportação ${btn} (${dl.suggestedFilename()})`);
  }
  await page.locator('.list-sel').getByRole('button', { name: 'Conflitos e pendências' }).click();
  await shot('relatorio-pendencias');

  console.log('8. Backup e persistência');
  await nav('Configurações e backups');
  const [bk] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '⬇ Baixar backup completo' }).click()]);
  const bkPath = await bk.path();
  const json = JSON.parse(fs.readFileSync(bkPath, 'utf8'));
  ok(json.schedules.length === 2 && json.isDemo === true, 'backup JSON contém as grades');
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForSelector('text=Painel');
  ok(await page.locator('.demo-banner').isVisible(), 'dados persistem após recarregar a página');
  await nav('Grade por turma');
  ok(await page.locator('table.sched .cell.locked').count() === 1, 'bloqueio persistiu');

  console.log('9. Voltar aos dados reais');
  await nav('Configurações e backups');
  await page.getByRole('tab', { name: 'Outras opções' }).click();
  await page.locator('main').getByRole('button', { name: 'Voltar aos dados reais' }).click();
  await page.waitForTimeout(500);
  ok(await page.locator('.demo-banner').count() === 0, 'dados reais restaurados');
  await nav('Painel inicial');
  ok(await page.locator('.stat', { hasText: 'Professores' }).locator('.stat-value').innerText() === '0', 'dados reais intactos (sem professores fictícios)');

  console.log('10. Tela pequena (tablet)');
  await page.setViewportSize({ width: 820, height: 1100 });
  await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page.waitForTimeout(300);
  await shot('tablet-menu');

  ok(errors.length === 0, 'nenhum erro de JavaScript no navegador' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log('\nTODOS OS PASSOS DO TESTE DE PONTA A PONTA PASSARAM.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
