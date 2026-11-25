import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, openDbForTests } from '@/db/db';
import { addGoals, deleteSource, listGoals, PINEALON_CAUTION, renameSource, seedGoalsOnce, toggleGoal, updateGoal } from '@/db/goals';
import { exportBackupJson, importBackup } from '@/db/backup';
import { ValidationError, wipeAll } from '@/db/repo';

let n = 0;
beforeEach(() => {
  openDbForTests(`test-goals-${n++}`);
  localStorage.clear();
});

describe('lista de metas', () => {
  it('agrega, tacha y destacha', async () => {
    const [a, b] = await addGoals([
      { source: 'Video 1', sourceUrl: 'https://www.youtube.com/watch?v=abc', text: 'Tomar sol 10 minutos al despertar', detail: 'Antes de las 9' },
      { source: 'Video 1', text: '  ' },
      { source: 'Video 1', text: 'Caminar después de comer' },
    ]);
    expect((await listGoals()).map((g) => g.text)).toEqual(['Tomar sol 10 minutos al despertar', 'Caminar después de comer']);
    expect(b.order).toBeGreaterThan(a.order);
    const done = await toggleGoal(a);
    expect(done.done).toBe(true);
    expect(done.doneAt).toBeTypeOf('number');
    const undone = await toggleGoal(done);
    expect(undone.done).toBe(false);
    expect(undone.doneAt).toBeUndefined();
  });

  it('valida el texto y el enlace', async () => {
    await expect(addGoals([{ source: 'X', text: 'Algo', sourceUrl: 'no es un enlace' }])).rejects.toBeInstanceOf(ValidationError);
    const [g] = await addGoals([{ source: 'X', text: 'Algo' }]);
    await expect(updateGoal(g.id, { text: '' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('ordena por grupo y permite renombrar y borrar un grupo', async () => {
    await addGoals([{ source: 'Video 1', text: 'A' }]);
    await addGoals([{ source: 'Video 2', text: 'B' }]);
    await addGoals([{ source: 'Video 1', text: 'C' }]);
    expect((await listGoals()).map((g) => g.text)).toEqual(['A', 'C', 'B']);
    await renameSource('Video 1', 'Rutina de la mañana', 'https://youtu.be/x');
    expect((await listGoals()).filter((g) => g.source === 'Rutina de la mañana')).toHaveLength(2);
    await deleteSource('Video 2');
    expect((await listGoals()).map((g) => g.text)).toEqual(['A', 'C']);
  });

  it('la primera vez agrega la compra del pinealon con su advertencia, sólo una vez', async () => {
    await seedGoalsOnce();
    await seedGoalsOnce();
    const all = await listGoals();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ text: 'Comprar el péptido pinealon', caution: PINEALON_CAUTION, done: false });
  });

  it('entra en la copia de seguridad y se borra con «borrar todo»', async () => {
    const [g] = await addGoals([{ source: 'Video 1', text: 'Dormir 8 horas' }]);
    await toggleGoal(g);
    const json = await exportBackupJson();
    await wipeAll();
    expect(await getDb().goals.count()).toBe(0);
    await importBackup(json, 'replace');
    const back = await listGoals();
    expect(back[0]).toMatchObject({ text: 'Dormir 8 horas', done: true });
  });

  it('las copias anteriores (sin metas) se siguen importando', async () => {
    const json = JSON.parse(await exportBackupJson());
    delete json.data.goals;
    await importBackup(JSON.stringify(json), 'replace');
    expect(await getDb().goals.count()).toBe(0);
  });
});

describe('listas listas para agregar', () => {
  it('cada lista es válida y se puede agregar completa', async () => {
    const { GOAL_PRESETS } = await import('@/domain/goalPresets');
    for (const p of GOAL_PRESETS) {
      const added = await addGoals(p.items.map((i) => ({ ...i, source: p.source, sourceUrl: p.sourceUrl })));
      expect(added).toHaveLength(p.items.length);
    }
    const all = await listGoals();
    expect(all.some((g) => g.text === 'Tomar larazotida 15 minutos antes de cada comida')).toBe(true);
    expect(all.filter((g) => /^Comprar (BPC-157|larazotida|KPV)$/.test(g.text)).every((g) => !!g.caution)).toBe(true);
  });
});
