import { jest } from '@jest/globals';
import { ConflictException, NotFoundException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { OrderPaymentService } from './order-payment.service';
import { OrderStatus } from '../enums/order-status.enum';

describe('OrderPaymentService', () => {
  let service: OrderPaymentService;
  let mockOrderRepository: any;
  let mockDataSource: any;
  let mockGatewayService: any;
  let mockTransactionsService: any;
  let mockNotificationsService: any;
  let mockDeliveryService: any;

  beforeEach(() => {
    mockOrderRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
    };

    mockDataSource = {
      getRepository: jest.fn().mockReturnValue({
        findOne: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
      }),
      createQueryRunner: jest.fn(),
    };

    mockGatewayService = {
      createTransaction: jest.fn(),
    };

    mockTransactionsService = {
      create: jest.fn(),
      updateStatus: jest.fn(),
    };

    mockNotificationsService = {
      sendPaymentApproved: jest.fn(),
      sendPaymentDeclined: jest.fn(),
    };

    mockDeliveryService = {
      updateStatus: jest.fn(),
    };

    service = new OrderPaymentService(
      mockOrderRepository,
      mockDataSource,
      mockGatewayService,
      mockTransactionsService,
      mockNotificationsService,
      mockDeliveryService,
    );
  });

  describe('payOrder - Validaciones de Seguridad y Pagos Duplicados', () => {
    it('debe lanzar NotFoundException si la orden no existe', async () => {
      mockOrderRepository.findOne.mockResolvedValue(null);

      await expect(
        service.payOrder({
          orderNumber: 'NON_EXISTENT',
          accessToken: 'token123',
          cardToken: 'tok_test',
          acceptanceToken: 'acc_token',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('debe lanzar UnauthorizedException si el accessToken es inválido', async () => {
      mockOrderRepository.findOne.mockResolvedValue({
        id: '1',
        orderNumber: 'JHM-1001',
        accessToken: 'correct-token',
        status: OrderStatus.PENDING_PAYMENT,
      });

      await expect(
        service.payOrder({
          orderNumber: 'JHM-1001',
          accessToken: 'wrong-token',
          cardToken: 'tok_test',
          acceptanceToken: 'acc_token',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('debe lanzar ConflictException (409 ORDER_ALREADY_PAID) si la orden ya está en estado PAID', async () => {
      mockOrderRepository.findOne.mockResolvedValue({
        id: '1',
        orderNumber: 'JHM-1001',
        accessToken: 'valid-token',
        status: OrderStatus.PAID,
      });

      await expect(
        service.payOrder({
          orderNumber: 'JHM-1001',
          accessToken: 'valid-token',
          cardToken: 'tok_test',
          acceptanceToken: 'acc_token',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('debe lanzar ConflictException (409 ORDER_ALREADY_PAID) si la orden ya fue entregada (DELIVERED)', async () => {
      mockOrderRepository.findOne.mockResolvedValue({
        id: '1',
        orderNumber: 'JHM-1002',
        accessToken: 'valid-token',
        status: OrderStatus.DELIVERED,
      });

      await expect(
        service.payOrder({
          orderNumber: 'JHM-1002',
          accessToken: 'valid-token',
          cardToken: 'tok_test',
          acceptanceToken: 'acc_token',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('debe lanzar BadRequestException si la orden está en estado CANCELLED', async () => {
      mockOrderRepository.findOne.mockResolvedValue({
        id: '1',
        orderNumber: 'JHM-1003',
        accessToken: 'valid-token',
        status: OrderStatus.CANCELLED,
      });

      await expect(
        service.payOrder({
          orderNumber: 'JHM-1003',
          accessToken: 'valid-token',
          cardToken: 'tok_test',
          acceptanceToken: 'acc_token',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
