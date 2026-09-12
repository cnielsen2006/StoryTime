import { z } from 'zod';
import { PlotLineKind, PlotPointStatus } from '../enums.js';
import { Id, OptionalText, RequiredName } from './common.js';

export const PlotLineCreate = z.object({
  name: RequiredName,
  description: OptionalText,
  kind: PlotLineKind.default('main'),
});
export type PlotLineCreate = z.infer<typeof PlotLineCreate>;

export const PlotLineUpdate = PlotLineCreate.partial();
export type PlotLineUpdate = z.infer<typeof PlotLineUpdate>;

export const PlotLine = z.object({
  id: Id,
  projectId: Id,
  name: z.string(),
  description: z.string().nullable(),
  kind: PlotLineKind,
  sortOrder: z.number().int(),
  revision: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type PlotLine = z.infer<typeof PlotLine>;

/** A plot point may be incomplete on purpose: status carries how firm it is. */
export const PlotPointCreate = z.object({
  title: RequiredName,
  summary: OptionalText,
  status: PlotPointStatus.default('idea'),
  notes: OptionalText,
  characterIds: z.array(Id).max(100).optional(),
  locationIds: z.array(Id).max(100).optional(),
});
export type PlotPointCreate = z.infer<typeof PlotPointCreate>;

export const PlotPointUpdate = PlotPointCreate.partial();
export type PlotPointUpdate = z.infer<typeof PlotPointUpdate>;

export const PlotPointMove = z.object({
  plotLineId: Id,
  sortOrder: z.number().int().min(0).optional(),
});
export type PlotPointMove = z.infer<typeof PlotPointMove>;

export const PlotPoint = z.object({
  id: Id,
  plotLineId: Id,
  projectId: Id,
  title: z.string(),
  summary: z.string().nullable(),
  status: PlotPointStatus,
  notes: z.string().nullable(),
  sortOrder: z.number().int(),
  revision: z.number().int(),
  characterIds: z.array(Id),
  locationIds: z.array(Id),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type PlotPoint = z.infer<typeof PlotPoint>;

export const PlotLineWithPoints = PlotLine.extend({
  points: z.array(PlotPoint),
});
export type PlotLineWithPoints = z.infer<typeof PlotLineWithPoints>;
