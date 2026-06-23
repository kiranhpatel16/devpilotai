from fastapi import HTTPException
from typing import Any


class HttpError(HTTPException):
    def __init__(self, status_code: int, message: str, code: str = "error", detail_extra: Any = None):
        detail = {"error": message, "code": code}
        if detail_extra:
            detail["detail"] = detail_extra
        super().__init__(status_code=status_code, detail=detail)
        self.message = message
        self.code = code

    @classmethod
    def bad_request(cls, message: str = "Bad request", code: str = "bad_request") -> "HttpError":
        return cls(400, message, code)

    @classmethod
    def unauthorized(cls, message: str = "Unauthorized", code: str = "unauthorized") -> "HttpError":
        return cls(401, message, code)

    @classmethod
    def forbidden(cls, message: str = "Forbidden", code: str = "forbidden") -> "HttpError":
        return cls(403, message, code)

    @classmethod
    def not_found(cls, message: str = "Not found", code: str = "not_found") -> "HttpError":
        return cls(404, message, code)

    @classmethod
    def conflict(cls, message: str = "Conflict", code: str = "conflict") -> "HttpError":
        return cls(409, message, code)
