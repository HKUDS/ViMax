from typing import List
import aiohttp
import asyncio
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential
import logging


class RerankerBgeSiliconapi:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str = "BAAI/bge-reranker-v2-m3",
    ):
        self.api_key = api_key
        self.base_url = base_url
        self.model = model
        # return_documents: bool = True,


    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, max=30),
        retry=retry_if_exception_type((aiohttp.ClientError, asyncio.TimeoutError)),
        reraise=True,
        after=lambda retry_state: logging.warning(f"Retrying SiliconReranker due to error: {retry_state.outcome.exception()}"),
    )
    async def __call__(
        self,
        documents: List[str],
        query: str,
        top_n: int,
    ) -> List[str]:
        
        url = f"{self.base_url}/rerank"

        payload = {
            "model": self.model,
            "query": query,
            "documents": documents,
            "top_n": top_n,
            "return_documents": True,
        }


        headers = {
            'Accept': 'application/json',
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json'
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=headers) as resp:
                response = await resp.json()
                if resp.status >= 400:
                    raise RuntimeError(f"Rerank request failed with HTTP {resp.status}: {response}")


        """
        {
            "id": "<string>",
            "results": [
                {
                "document": {
                    "text": "<string>"
                },
                "index": 123,
                "relevance_score": 123
                }
            ],
            "tokens": {
                "input_tokens": 123,
                "output_tokens": 123
            }
        } 
        """

        results = []

        for result in response["results"]:
            results.append((result["document"]["text"], result["relevance_score"]))

        return results