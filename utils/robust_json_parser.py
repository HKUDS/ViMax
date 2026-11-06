# Some chat models (observed with gemini-flash-lite via the OpenAI-compatible
# endpoint) frequently emit a trailing comma before a closing `}`/`]` in
# structured JSON responses (e.g. `"variation_reason": "...",\n}`). That is
# invalid JSON, so PydanticOutputParser raises OutputParserException even
# though the payload is otherwise well-formed and semantically complete --
# and resampling burns LLM calls while often failing the same way again.
# Wrap PydanticOutputParser so a parse failure retries locally with trailing
# commas stripped before giving up.
import re
from typing import List, Optional

from langchain_core.exceptions import OutputParserException
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.outputs import Generation

_TRAILING_COMMA_RE = re.compile(r",(\s*[}\]])")


def strip_trailing_commas(text: str) -> str:
    return _TRAILING_COMMA_RE.sub(r"\1", text)


class TrailingCommaTolerantPydanticOutputParser(PydanticOutputParser):
    """PydanticOutputParser that retries once with trailing commas stripped."""

    def parse_result(self, result: List[Generation], *, partial: bool = False):
        try:
            return super().parse_result(result, partial=partial)
        except OutputParserException:
            if not result:
                raise
            cleaned_text = strip_trailing_commas(result[0].text)
            if cleaned_text == result[0].text:
                raise
            cleaned_result = [Generation(text=cleaned_text)]
            return super().parse_result(cleaned_result, partial=partial)
