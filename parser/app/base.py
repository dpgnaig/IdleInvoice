"""Interface chung cho các parser."""
from __future__ import annotations

from abc import ABC, abstractmethod

from .models import ParsedQuote


class QuoteParser(ABC):
    name = "base"

    @abstractmethod
    def can_parse(self, filename: str) -> bool:
        ...

    @abstractmethod
    def parse(self, data: bytes, filename: str) -> ParsedQuote:
        ...
