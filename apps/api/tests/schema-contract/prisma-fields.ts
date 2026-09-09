// Chequeo de tipos REAL (sin `as any`) de cada campo que consulta
// file-access-service. Si algún nombre no existe en el modelo, esto no compila.
import type { Prisma } from "../../../../generated/prisma";

const certificate: Prisma.CertificateWhereInput = { tenantId: "", originalSourceLink: { in: [] } };
const certRenewal: Prisma.CertificateRenewalWhereInput = { tenantId: "", previousSourceLink: { in: [] } };
const plan: Prisma.MaintenancePlanWhereInput = { tenantId: "", checklistTemplate: { in: [] } };
const fluid: Prisma.FluidAnalysisResultWhereInput = { tenantId: "", reportUrl: { in: [] } };
const fluidSel: Prisma.FluidAnalysisResultSelect = { sample: { select: { vesselCode: true } } };
const receipt: Prisma.GoodsReceiptWhereInput = { tenantId: "", fileUrl: { in: [] }, };
const attachment: Prisma.AttachmentWhereInput = { tenantId: "", description: { in: [] }, deletedAt: null };
const progress: Prisma.WorkOrderProgressNoteWhereInput = { tenantId: "", fileUrl: { in: [] } };
const wo: Prisma.WorkOrderWhereInput = {
  tenantId: "",
  OR: [{ checklistDocUrl: { in: [] } }, { supportingDocUrl: { in: [] } }],
};
const membership: Prisma.TenantMembershipWhereUniqueInput = { tenantId_userId: { tenantId: "", userId: "" } };
const membershipSel: Prisma.TenantMembershipSelect = {
  role: true, status: true, assignedVesselCodes: true, user: { select: { status: true } },
};
const runWhere: Prisma.ScheduledReportRunWhereInput = {
  tenantId: "", reportKind: "WEEKLY_OPENING", periodKey: "",
  status: "FAILED", error: "PENDING_SEND", sentAt: { lt: new Date() },
};
const runCreate: Prisma.ScheduledReportRunUncheckedCreateInput = {
  tenantId: "", reportKind: "WEEKLY_OPENING", periodKey: "",
  status: "FAILED", error: "PENDING_SEND", recipients: [],
};
const refresh: Prisma.RefreshTokenWhereInput = {
  tenantId: "", userId: "", revokedAt: null, refreshTokenHash: { not: "" },
};
const goodsUnique: Prisma.GoodsReceiptWhereUniqueInput = { tenantId_receiptCode: { tenantId: "", receiptCode: "" } };

void [certificate, certRenewal, plan, fluid, fluidSel, receipt, attachment, progress, wo,
      membership, membershipSel, runWhere, runCreate, refresh, goodsUnique];
