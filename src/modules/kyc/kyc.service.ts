import { pool } from "../../config/db";
import { StorageService } from "../storage/storage.service";
import { BookingDomainError } from "../booking/booking.errors";

export class KycService {
  /**
   * STEP 1. Generate pre-signed URL for driver's license upload
   */
  public static async requestLicenseUploadUrl(
    userId: string,
    side: "FRONT" | "BACK",
  ) {
    const userRes = await pool.query(
      `SELECT id, kyc_status FROM users WHERE id = $1`,
      [userId],
    );

    if (userRes.rowCount === 0) {
      throw new BookingDomainError(`User with ID ${userId} not found.`, 404);
    }

    return await StorageService.generateUploadUrl(
      "kyc",
      userId,
      `license_${side.toLowerCase()}.jpg`,
      "image/jpeg",
    );
  }

  /**
   * STEP 2. Client signals that files are uploaded. Triggers verification pipeline.
   */
  public static async submitLicenseForVerification(
    userId: string,
    frontFileKey: string,
    backFileKey: string,
    licenseExpirationDate: string,
  ): Promise<{ status: string }> {
    const expDate = new Date(licenseExpirationDate);

    if (expDate <= new Date()) {
      throw new BookingDomainError("Driver license has already expired.", 400);
    }

    await pool.query(
      `UPDATE users
      SET kyc_status = 'PENDING_REVIEW', updated_at = NOW()
      WHERE id = $1`,
      [userId],
    );

    // Audit log (NFR-7.1)
    await pool.query(
      `INSERT INTO audit_logs (
        actor_id, actor_role, action, resource_type, resource_id, ip_address, changes
      ) VALUES ($1, 'RENTER', 'KYC_SUBMISSION', 'USER', $1, '127.0.0.1', $2)`,
      [
        userId,
        JSON.stringify({ frontFileKey, backFileKey, licenseExpirationDate }),
      ],
    );

    return { status: "PENDING_REVIEW" };
  }

  /**
   * STEP 3. Automated webhook from KYC verification provider (Persona/Onfido/Stripe)
   */
  public static async processKycProviderWebhook(
    userId: string,
    decision: "APPROVED" | "REJECTED",
    rejectionReason?: string,
  ): Promise<void> {
    const newStatus = decision === "APPROVED" ? "VERIFIED" : "REJECTED";
    const verifiedAt = decision === "APPROVED" ? new Date() : null;

    await pool.query(
      `UPDATE users
      SET kyc_status = $1, kyc_verified_at = $2, updated_at = NOW()
      WHERE id = $3`,
      [newStatus, verifiedAt, userId],
    );

    console.log(
      `[KYC Engine] Status of user with ID ${userId} transitionned to ${newStatus}`,
    );
  }
}
