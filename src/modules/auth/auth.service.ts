import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { pool } from "../../config/db";
import { redis } from "../../config/redis";
import { AuthenticatedUser } from "../../middlewares/auth.middleware";

const JWT_SECRET =
  process.env.JWT_SECRET || "cyphrdrive_ultra_secure_jwt_secret_key_2026";

export class AuthService {
  /**
   * Register a new Renter with Argon2id password hashing (NFR-2.3)
   */
  public static async register(data: {
    email: string;
    phone: string;
    password: string;
    firstName: string;
    lastName: string;
  }) {
    const passwordHash = await argon2.hash(data.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const res = await pool.query(
      `INSERT INTO users (email, phone_number, password_hash, first_name, last_name, role, kyc_status)
      VALUES ($1, $2, $3, $4, $5, 'RENTER', 'UNVERIFIED')
      RETURNING id, email, first_name, last_name, role, kyc_status`,
      [data.email, data.phone, passwordHash, data.firstName, data.lastName],
    );

    const user = res.rows[0];

    // Trigger OTP for first login (FR-1.6)
    const otp = await this.generateOtp(user.id);

    return { user, otpDebug: otp };
  }

  /**
   * Login with OTP gate (FR-1.2, FR-1.6)
   */
  public static async login(email: string, password: string) {
    const res = await pool.query(
      `SELECT u.*, array_remove(array_agg(fab.branch_id), NULL) as branch_ids
      FROM users u
      LEFT JOIN fleet_admin_branches fab ON u.id = fab.user_id
      WHERE u.email = $1
      GROUP BY u.id`,
      [email],
    );

    if (res.rows.length === 0) {
      throw new Error("Invalid Email or password.");
    }

    const user = res.rows[0];
    const passwordValid = await argon2.verify(user.password_hash, password);
    if (!passwordValid) {
      throw new Error("Invalid Email or password.");
    }

    const payload: AuthenticatedUser = {
      userId: user.id,
      email: user.email,
      role: user.role,
      branchIds: user.branch_ids || [],
    };

    const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        kycStatus: user.kyc_status,
        branches: user.branch_ids || [],
      },
    };
  }

  /**
   * Generate 6-Digit OTP with 5-minute TTL (FR-1.5, FR-1.6)
   */
  public static async generateOtp(userId: string): Promise<string> {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await redis.set(`otp:${userId}`, otp, "EX", 300); // 5 minutes
    console.log(`🔑 [OTP Dispatch] Code for User ${userId}: ${otp}`);
    return otp;
  }

  /**
   * Verify OTP (FR-1.6, FR-1.7)
   */
  public static async verifyOtp(
    userId: string,
    inputOtp: string,
  ): Promise<boolean> {
    const storedOtp = await redis.get(`otp:${userId}`);
    if (!storedOtp || storedOtp !== inputOtp) {
      return false;
    }
    await redis.del(`otp:${userId}`);
    return true;
  }
}
