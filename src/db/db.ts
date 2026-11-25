/**
 * Base de datos local (IndexedDB) mediante Dexie.
 *
 * Existen dos bases independientes:
 *  - `digesta`       → tus datos reales.
 *  - `digesta-demo`  → datos de demostración generados, nunca mezclados con los reales.
 *
 * El modo activo se guarda en localStorage y cambiarlo recarga la app.
 */
import Dexie, { type Table } from 'dexie';
import type { CustomFood, DailyLog, FavoriteMeal, Fast, FoodNote, Goal, Meal, Photo, SettingRow, Stool, Symptom } from '@/domain/types';

export type DbMode = 'real' | 'demo';
export const DB_NAMES: Record<DbMode, string> = { real: 'digesta', demo: 'digesta-demo' };
const MODE_KEY = 'digesta:mode';

export class DigestaDB extends Dexie {
  meals!: Table<Meal, string>;
  stools!: Table<Stool, string>;
  symptoms!: Table<Symptom, string>;
  dailyLogs!: Table<DailyLog, string>;
  favorites!: Table<FavoriteMeal, string>;
  customFoods!: Table<CustomFood, string>;
  foodNotes!: Table<FoodNote, string>;
  photos!: Table<Photo, string>;
  settings!: Table<SettingRow, string>;
  fasts!: Table<Fast, string>;
  goals!: Table<Goal, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      meals: 'id, at, mealType, *itemKeys',
      stools: 'id, at, bristol',
      symptoms: 'id, startedAt, type',
      dailyLogs: 'day',
      favorites: 'id, name, uses',
      customFoods: 'key, name',
      foodNotes: 'key',
      photos: 'id, createdAt',
      settings: 'key',
    });
    // v2: ayuno intermitente
    this.version(2).stores({ fasts: 'id, startAt, endAt' });
    // v3: lista de metas
    this.version(3).stores({ goals: 'id, source, order' });
  }
}

/** Lista de tablas, en el orden usado por respaldos y borrado. */
export const TABLE_NAMES = ['meals', 'stools', 'symptoms', 'dailyLogs', 'favorites', 'customFoods', 'foodNotes', 'photos', 'settings', 'fasts', 'goals'] as const;
export type TableName = (typeof TABLE_NAMES)[number];

export function readMode(): DbMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'demo' ? 'demo' : 'real';
  } catch {
    return 'real';
  }
}

export function writeMode(mode: DbMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* sin almacenamiento: se queda en modo real */
  }
}

let current: DigestaDB | null = null;
let currentMode: DbMode = 'real';

/** Base activa (singleton). */
export function getDb(): DigestaDB {
  if (!current) {
    currentMode = readMode();
    current = new DigestaDB(DB_NAMES[currentMode]);
  }
  return current;
}

export function getMode(): DbMode {
  getDb();
  return currentMode;
}

/** Sólo para pruebas: abre una base concreta como activa. */
export function openDbForTests(name: string): DigestaDB {
  current?.close();
  current = new DigestaDB(name);
  currentMode = 'real';
  return current;
}
