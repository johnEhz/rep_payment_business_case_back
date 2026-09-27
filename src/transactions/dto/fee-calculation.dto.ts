export class FeeCalculationResponseDto {
  productPriceInCents: number;
  baseFeeInCents: number;
  deliveryFeeInCents: number;
  deliveryDistanceKm?: number;
  deliveryDistanceCostInCents?: number;
  deliveryValueCostInCents?: number;
  deliveryDiscountInCents?: number;
  deliveryAppliedRules?: {
    distanceRule: string;
    valueRule: string;
    discountRule: string;
  };
  totalAmountInCents: number;
  currency: string;
}
