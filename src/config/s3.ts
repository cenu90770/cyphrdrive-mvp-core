import { S3Client } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

const region = process.env.AWS_REGION || 'eu-central-1';
const endpoint = process.env.S2_ENDPOINT; // For MinIO or LocalStack if used

export const s3client = new S3Client({
	region,
	endpoint: endpoint || undefined,
	credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'mock_access_key',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'mock_secret_key'
	},
	forcePathStyle: !!endpoint, // Required for MinIO
});

export const S3_BUCKET_NAME = process.env.AWS_S3_BUCKET || 'cyphrdrive-production-media';