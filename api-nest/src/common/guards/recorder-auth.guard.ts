import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

@Injectable()
export class RecorderAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.headers.authorization?.split(' ')[1];
    const claims = token && this.tryVerify(token);

    if (!claims || claims.role !== 'recorder') {
      throw new UnauthorizedException();
    }
    return true;
  }

  private tryVerify(token: string): Record<string, unknown> | null {
    try {
      return this.jwtService.verify(token);
    } catch {
      return null;
    }
  }
}
