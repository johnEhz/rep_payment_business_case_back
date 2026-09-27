import { DeliveryCalculationResult } from '../delivery.service';

export interface IDeliveryFeeCalculator {
  calculateDeliveryFee(
    totalPurchaseAmountInCents: number,
    address?: string,
    city?: string,
    providedCoords?: { latitude: number; longitude: number },
  ): Promise<DeliveryCalculationResult>;
}
