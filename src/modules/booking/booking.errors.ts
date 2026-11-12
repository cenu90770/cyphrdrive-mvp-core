export class BookingDomainError extends Error {
  constructor(message: string, public readonly statusCode: number = 400) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class VehicleNotFoundError extends BookingDomainError {
  constructor(vehicleId: string) {
    super(`Vehicle with ID ${vehicleId} not found.`, 404);
  }
}

export class DoubleBookingConflictError extends BookingDomainError {
  constructor(vehicleId: string) {
    super(`Vehicle with ID ${vehicleId} is no longer available for the selected dates.`, 409);
  }
}

export class InvalidBookingDateError extends BookingDomainError {
  constructor(startDate: Date, endDate: Date) {
    super(`Invalid booking dates: start date ${startDate.toISOString()} must be before end date ${endDate.toISOString()}.`);
  }
}

export class KycVerificationFailedError extends BookingDomainError {
  constructor(userId: string) {
    super(`KYC verification failed for user ID ${userId}.`, 403);
  }
}

export class BookingHoldExpiredError extends BookingDomainError {
  constructor(bookingReference: string) {
    super(`Booking hold for reference ${bookingReference} has expired.`, 410);
  }
}
    