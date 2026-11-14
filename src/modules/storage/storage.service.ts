import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";
import { s3client, S3_BUCKET_NAME } from "../../config/s3";

export type AllowedMimeType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "application/pdf";

export interface PresignedUploadResponse {
  uploadUrl: string;
  fileKey: string;
  expiresInSeconds: number;
}

export class StorageService {
  private static readonly DEFAULT_EXPIRATION = 900; // 15 minutes

  /**
   * Generates a signed PUT URL. Client uploads binary data rirectly to AWS S3.
   */
  public static async generateUploadUrl(
    folder: "kyc" | "inspections" | "fleet-docs",
    subId: string, // userId, vehicleId, or bookingId
    fileName: string,
    mimeType: AllowedMimeType,
  ): Promise<PresignedUploadResponse> {
    const fileExtension = fileName.split(".").pop()?.toLowerCase() || "jpg";
    const uniqueHash = crypto.randomBytes(6).toString("hex");
    const fileKey = `${folder}/${subId}/${Date.now()}_${uniqueHash}.${fileExtension}`;

    // Fallback mode if credentials are mock/placeholder
    if (process.env.AWS_ACCESS_KEY_ID?.includes("mock")) {
      return {
        uploadUrl: `https://${S3_BUCKET_NAME}.s3.eu-central-1.amazonaws.com/${fileKey}?mock_signature=valid_token`,
        fileKey,
        expiresInSeconds: this.DEFAULT_EXPIRATION,
      };
    }

    const command = new PutObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: fileKey,
      ContentType: mimeType,
    });

    const uploadUrl = await getSignedUrl(s3client, command, {
      expiresIn: this.DEFAULT_EXPIRATION,
    });

    return {
      uploadUrl,
      fileKey,
      expiresInSeconds: this.DEFAULT_EXPIRATION,
    };
  }

  /**
   * Generates a signed GET URL to securely view private files (admin viewing KYC or inspection documents)
   */
  public static async generateDowloadUrl(fileKey: string): Promise<string> {
    if (process.env.AWS_ACCESS_KEY_ID?.includes("mock")) {
      return `https://${S3_BUCKET_NAME}.s3.eu-central-1.amazonaws.com/${fileKey}?view_token=mock`;
    }

    const command = new GetObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: fileKey,
    });

    return await getSignedUrl(s3client, command, { expiresIn: 3600 }); // 1 hour for read token
  }
}
