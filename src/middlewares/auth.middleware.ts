import { error } from "console";
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: "RENTER" | "FLEET_ADMIN" | "SUPER_ADMIN";
  branchIds: string[]; // Branches this Fleet Admin is assigned to
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

const JWT_SECRET =
  process.env.JWT_SECRET || "cyphrdrive_ultra_secure_jwt_secret_key_2026";

export const authenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1]; // Bearer <token>

  if (!token) {
    res.status(401).json({ error: "Authentication token requuired." });
    return;
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      res.status(403).json({ error: "Invalid or expired token." });
      return;
    }
    req.user = decoded as AuthenticatedUser;
    next();
  });
};

export const requireRole = (
  roles: Array<"RENTER" | "FLEET_ADMIN" | "SUPER_ADMIN">,
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res
        .status(403)
        .json({ error: "Access denied: Insufficient permissions." });
      return;
    }
    next();
  };
};

export const requireBranchAccess = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  // Super Admins have global access to all branches
  if (req.user.role === "SUPER_ADMIN") {
    return next();
  }

  const requestedBranchId = (req.params.branchId ||
    req.query.branchId ||
    req.body.branchId) as string;

  if (requestedBranchId && !req.user.branchIds.includes(requestedBranchId)) {
    res.status(403).json({
      error: `Access denied: You are not authorized to managed branch ${requestedBranchId}.`,
    });
    return;
  }

  next();
};
