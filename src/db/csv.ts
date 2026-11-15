/**
 * Exportación CSV de registros. Usa punto y coma como separador y BOM UTF-8
 * para que Excel en español (Colombia) lo abra correctamente.
 */
import { dayKey, formatTime } from '@/domain/dates';
import {
  BLOOD_OPTIONS,
  EFFORT_LABELS,
  URGENCY_LABELS,
  digestionLabel,
  flagLabel,
  mealTypeLabel,
  preparationLabel,
  quantityLabel,
  stoolColorLabel,
  symptomLabel,
  zoneLabel,
  FEELINGS,
} from '@/domain/labels';
import type { DailyLog, Fast, Meal, Stool, Symptom } from '@/domain/types';

export const CSV_SEP = ';';

export function csvCell(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  if (/[";\n\r,]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(CSV_SEP));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

const yn = (b: boolean) => (b ? 'Sí' : 'No');

export function mealsCsv(meals: Meal[]): string {
  const header = ['Fecha', 'Hora', 'Tipo', 'Alimento', 'Cantidad', 'Preparación', 'Ingredientes', 'Marcas', 'Suplementos', 'Sensación', 'Notas'];
  const rows: unknown[][] = [];
  for (const m of meals) {
    const feeling = FEELINGS.find((f) => f.value === m.feelingAfter)?.label ?? '';
    for (const it of m.items) {
      rows.push([
        dayKey(m.at),
        formatTime(m.at),
        mealTypeLabel(m.mealType),
        it.name,
        it.quantity === 'personalizada' ? it.customQuantity ?? 'Otra' : quantityLabel(it.quantity),
        it.preparation ? preparationLabel(it.preparation) : '',
        (it.ingredients ?? []).join(', '),
        m.flags.map(flagLabel).join(', '),
        m.supplements.join(', '),
        feeling,
        m.notes ?? '',
      ]);
    }
  }
  return toCsv(header, rows);
}

export function stoolsCsv(stools: Stool[]): string {
  const header = ['Fecha', 'Hora', 'Bristol', 'Color', 'Cantidad', 'Urgencia', 'Esfuerzo', 'Dolor antes', 'Dolor durante', 'Dolor después', 'Intensidad dolor', 'Evacuación incompleta', 'Moco', 'Sangre', 'Notas'];
  const rows = stools.map((s) => [
    dayKey(s.at),
    formatTime(s.at),
    s.bristol,
    stoolColorLabel(s.color),
    s.amount,
    URGENCY_LABELS[s.urgency],
    EFFORT_LABELS[s.effort],
    yn(s.pain.before),
    yn(s.pain.during),
    yn(s.pain.after),
    s.painIntensity ?? '',
    yn(s.incomplete),
    yn(s.mucus),
    BLOOD_OPTIONS.find((b) => b.value === s.blood)?.label ?? s.blood,
    s.notes ?? '',
  ]);
  return toCsv(header, rows);
}

export function symptomsCsv(symptoms: Symptom[]): string {
  const header = ['Fecha', 'Hora inicio', 'Síntoma', 'Intensidad (0-10)', 'Hora fin', 'Duración (min)', 'Ubicación', 'Notas'];
  const rows = symptoms.map((s) => {
    const dur = s.endedAt ? Math.round((s.endedAt - s.startedAt) / 60000) : s.durationMin ?? '';
    return [dayKey(s.startedAt), formatTime(s.startedAt), symptomLabel(s.type, s.customName), s.intensity, s.endedAt ? formatTime(s.endedAt) : '', dur, zoneLabel(s.location), s.notes ?? ''];
  });
  return toCsv(header, rows);
}

export function dailyCsv(logs: DailyLog[]): string {
  const header = ['Fecha', 'Digestión del día', 'Vasos de agua', 'Estrés (0-10)', 'Horas de sueño', 'Calidad del sueño', 'Ejercicio', 'Minutos de ejercicio', 'Intensidad ejercicio', 'Notas'];
  const q = { 1: 'Mala', 2: 'Regular', 3: 'Buena' } as const;
  const rows = [...logs]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((l) => [
      l.day,
      l.digestion ? digestionLabel(l.digestion) : '',
      l.water ?? '',
      l.stress ?? '',
      l.sleepHours ?? '',
      l.sleepQuality ? q[l.sleepQuality] : '',
      l.exercise?.type ?? '',
      l.exercise?.minutes ?? '',
      l.exercise?.intensity ?? '',
      l.notes ?? '',
    ]);
  return toCsv(header, rows);
}

export function fastsCsv(fasts: Fast[]): string {
  const header = ['Inicio (fecha)', 'Inicio (hora)', 'Fin (fecha)', 'Fin (hora)', 'Duración (h)', 'Meta (h)', 'Esquema', 'Meta cumplida', 'Hambre (0-10)', 'Energía', 'Cómo le fue', 'Notas'];
  const rows = [...fasts]
    .filter((f) => f.endAt !== undefined)
    .sort((a, b) => a.startAt - b.startAt)
    .map((f) => {
      const h = (f.endAt! - f.startAt) / 3600_000;
      return [
        dayKey(f.startAt),
        formatTime(f.startAt),
        dayKey(f.endAt!),
        formatTime(f.endAt!),
        h.toFixed(1).replace('.', ','),
        f.targetHours,
        f.protocol,
        yn(h >= f.targetHours - 0.25),
        f.hunger ?? '',
        f.energy ? ['', 'Baja', 'Normal', 'Alta'][f.energy] : '',
        (f.sideEffects ?? []).join(', '),
        f.notes ?? '',
      ];
    });
  return toCsv(header, rows);
}
