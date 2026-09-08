import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { CreateCheckoutDto } from './dto/create-checkout.dto.js';

// Rails renders this with a plain `render json:` (200), not Nest's
// default 201 for @Post().
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('checkout')
  @HttpCode(200)
  checkout(@Body() dto: CreateCheckoutDto) {
    return this.paymentsService.checkout(dto);
  }
}
