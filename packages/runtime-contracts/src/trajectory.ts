import { z } from 'zod';

export const rawTrajectorySampleSchema = z.strictObject({
  timestamp: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  altitude: z.number().finite()
});
export type RawTrajectorySample = z.infer<typeof rawTrajectorySampleSchema>;

export const trajectoryPointSchema = z.strictObject({
  timeMs: z.number().int().nonnegative(),
  longitude: z.number().finite().min(-180).max(180),
  latitude: z.number().finite().min(-90).max(90),
  altitudeM: z.number().finite()
});

export const trajectorySchema = z.strictObject({
  schemaVersion: z.literal('ise-trajectory/v1'),
  /** UTC source clock origin, retained so separate trajectories can share a clock. */
  sourceTimeOriginMs: z.number().int().nonnegative().optional(),
  points: z.array(trajectoryPointSchema).min(2)
}).superRefine((trajectory, context) => {
  for (let index = 1; index < trajectory.points.length; index += 1) {
    if (trajectory.points[index]!.timeMs <= trajectory.points[index - 1]!.timeMs) {
      context.addIssue({ code: 'custom', path: ['points', index, 'timeMs'], message: 'Trajectory time must be strictly increasing' });
    }
  }
});
export type NormalizedTrajectory = z.infer<typeof trajectorySchema>;

function parseTimestampUtc(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(value);
  if (!match) throw new Error(`Invalid trajectory timestamp: ${value}`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = '0'] = match;
  const year = Number(yearText);
  const month = Number(monthText) - 1;
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(fraction.padEnd(3, '0'));
  const parsed = Date.UTC(year, month, day, hour, minute, second, millisecond);
  const check = new Date(parsed);
  if (
    check.getUTCFullYear() !== year || check.getUTCMonth() !== month ||
    check.getUTCDate() !== day || check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second ||
    check.getUTCMilliseconds() !== millisecond
  ) {
    throw new Error(`Invalid trajectory timestamp: ${value}`);
  }
  return parsed;
}

export function normalizeTrajectorySamples(input: RawTrajectorySample[]): NormalizedTrajectory {
  const samples = z.array(rawTrajectorySampleSchema).min(2).parse(input);
  const groups: Array<{ parsedMs: number; samples: RawTrajectorySample[] }> = [];
  for (const sample of samples) {
    const parsedMs = parseTimestampUtc(sample.timestamp);
    const previous = groups.at(-1);
    if (previous && parsedMs < previous.parsedMs) {
      throw new Error('Trajectory timestamps reverse source order');
    }
    if (previous?.parsedMs === parsedMs) previous.samples.push(sample);
    else groups.push({ parsedMs, samples: [sample] });
  }

  const originMs = groups[0]!.parsedMs;
  const points = groups.flatMap((group, groupIndex) => {
    const next = groups[groupIndex + 1];
    const previous = groups[groupIndex - 1];
    const gap = next
      ? next.parsedMs - group.parsedMs
      : previous
        ? group.parsedMs - previous.parsedMs
        : 1000;
    const baseMs = group.parsedMs - originMs;
    return group.samples.map((sample, index) => ({
      timeMs: baseMs + Math.floor(index * gap / group.samples.length),
      longitude: sample.longitude,
      latitude: sample.latitude,
      altitudeM: sample.altitude
    }));
  });

  // Preserve the absolute source clock alongside relative playback samples so
  // independent routes can later be synchronized without reconstructing it.
  return trajectorySchema.parse({ schemaVersion: 'ise-trajectory/v1', sourceTimeOriginMs: originMs, points });
}
