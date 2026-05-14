-- Agregar PILOT (Práctico) y PILOTIN (Pilotín) al enum CrewRank.

ALTER TYPE "CrewRank" ADD VALUE IF NOT EXISTS 'PILOT';
ALTER TYPE "CrewRank" ADD VALUE IF NOT EXISTS 'PILOTIN';
