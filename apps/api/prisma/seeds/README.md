# Crew Training Seeds

This directory contains SQL seed files for the crew training/rank management system CEOP integration.

## Files

### capitalmaritima (CEOP - Brazilian Standard)
- **seed-ranks-ceop-capitalmaritima.sql** (23 ranks)
  - Positions per CEOP Brazilian Training Matrix
  - Portuguese (PT-BR) labels
  - Deck, Engine, Services roles
  
- **seed-training-items-ceop-capitalmaritima.sql** (~38+ items, expandable to ~180)
  - STCW requirements (I/1, III/1, VI/2, etc.)
  - GMDSS certifications
  - Safety & medical training
  - Environmental regulations (MARPOL)
  - DP (Dynamic Positioning) & ECDIS courses
  - Company-specific training
  
- **seed-rank-requirements-ceop-capitalmaritima.sql**
  - Maps 23 ranks × training items with levels:
    - OBRIGATORIO (Mandatory)
    - VALIDO (Valid/Recommended)
    - DESEJAVEL (Desirable)
  - Validity periods per requirement
  - Covers Master, Chief Officers, Engineers, Crew roles

### mercurio & demo (Spanish Default)
- **seed-training-items-default-es.sql** (~38 items)
  - Spanish (ES) labels for all training
  - STCW standards (II/1, III/1, VI/1-4, etc.)
  - GMDSS & radio certifications
  - Safety, medical, cargo handling
  - Environmental & regulatory (MARPOL, OPA, PSC)
  - Company-specific induction + ISM/SMS
  - Dynamic Positioning & ECDIS
  
- **seed-rank-requirements-default-es.sql**
  - Maps 21 standard ranks × training items
  - Levels: OBRIGATORIO, VALIDO, DESEJAVEL
  - Simplified matrix (subset of CEOP approach)
  - Applies to mercurio + demo tenants

## How to Execute

### Option 1: Direct psql (Recommended)
```bash
# For capitalmaritima (full CEOP matrix)
psql $DATABASE_URL -f seed-ranks-ceop-capitalmaritima.sql
psql $DATABASE_URL -f seed-training-items-ceop-capitalmaritima.sql
psql $DATABASE_URL -f seed-rank-requirements-ceop-capitalmaritima.sql

# For mercurio & demo (Spanish defaults)
psql $DATABASE_URL -f seed-training-items-default-es.sql
psql $DATABASE_URL -f seed-rank-requirements-default-es.sql
```

### Option 2: Via Node.js (using Prisma)
```bash
# Execute in order via a Node script
npx node -e "
  const { execSync } = require('child_process');
  const db = process.env.DATABASE_URL;
  
  // capitalmaritima
  execSync(\`psql \${db} -f apps/api/prisma/seeds/seed-ranks-ceop-capitalmaritima.sql\`);
  execSync(\`psql \${db} -f apps/api/prisma/seeds/seed-training-items-ceop-capitalmaritima.sql\`);
  execSync(\`psql \${db} -f apps/api/prisma/seeds/seed-rank-requirements-ceop-capitalmaritima.sql\`);
  
  // mercurio + demo
  execSync(\`psql \${db} -f apps/api/prisma/seeds/seed-training-items-default-es.sql\`);
  execSync(\`psql \${db} -f apps/api/prisma/seeds/seed-rank-requirements-default-es.sql\`);
"
```

## Schema Structure

### RankDefinition
- id, tenantId, code, name, sortOrder, createdAt, updatedAt
- Unique per (tenantId, code)

### TrainingItem
- id, tenantId, code, name, regulation, category, validityYears, sortOrder, createdAt, updatedAt
- Categories: STCW, GMDSS, SAFETY, MEDICAL, ENVIRONMENTAL, REGULATORY, COMPANY, DP, ECDIS, etc.

### RankTrainingRequirement
- id, rankDefinitionId, trainingItemId, level, validityYears, createdAt, updatedAt
- Levels: OBRIGATORIO, VALIDO, DESEJAVEL
- Unique per (rankDefinitionId, trainingItemId)

## Notes

- **Idempotent**: All files use `ON CONFLICT ... DO UPDATE` to allow re-runs
- **Tenant-scoped**: Each file only affects specified tenant(s)
- **Cleanup**: Files delete existing data for the tenant before seeding
- **Portuguese/Spanish**: Labels match tenant locale (capitalmaritima=PT, mercurio/demo=ES)

## CEOP Expansion

The capitalmaritima seeds provide a representative sample (~38 training items, ~200+ requirements). Full CEOP matrix includes:
- ~180+ training items covering all STCW sections, regulations, and specialized domains
- ~1000+ rank-requirement mappings with specific validity periods per CEOP regulation

To expand:
1. Extract full CEOP matrix from source document (PDF, Excel, etc.)
2. Parse into training items + requirement entries
3. Append INSERT statements to the SQL files or create additional seed files
4. Maintain ON CONFLICT structure for idempotency
