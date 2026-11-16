import { Request, Response } from "express";
import { AuthService } from "./auth.service";

export class AuthController {
  public static async register(req: Request, res: Response): Promise<void> {
    try {
      const result = await AuthService.register(req.body);
      res.status(201).json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  public static async loging(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;
      const result = await AuthService.login(email, password);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(401).json({ error: err.message });
    }
  }

  public static async verifyOtp(req: Request, res: Response): Promise<void> {
    try {
      const { userId, otp } = req.body;
      const isValid = await AuthService.verifyOtp(userId, otp);
      if (!isValid) {
        res.status(400).json({ error: 'Invalid or expired OTP code'});
        return;
      }
      res.status(200).json({ verified: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
}
