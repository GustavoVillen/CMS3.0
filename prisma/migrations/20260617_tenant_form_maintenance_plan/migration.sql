-- AlterEnum: nuevo tipo de formulario controlado para el Plan de mantenimiento
ALTER TYPE "TenantFormType" ADD VALUE IF NOT EXISTS 'MAINTENANCE_PLAN';
