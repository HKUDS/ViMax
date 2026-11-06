import os
import logging
import asyncio
from typing import List, Tuple
from langchain_core.messages import HumanMessage, SystemMessage
from langchain.chat_models import init_chat_model
from langchain_text_splitters import RecursiveCharacterTextSplitter



system_prompt_template_compress_novel_chunk = \
"""
You are an expert text compression assistant specialized in literary content. Your goal is to condense novels or story excerpts while preserving core narrative elements, key details, character development, and plot coherence.


**TASK**
Compress the provided input text to reduce its length significantly, eliminating redundancies, overly descriptive passages, and minor details—but without losing essential story arcs, dialogue, or emotional impact. Aim for clarity and readability in the compressed output.


**INPUT**
A segment of a novel (possibly truncated due to context length constraints). It is enclosed within <NOVEL_CHUNK_START> and <NOVEL_CHUNK_END> tags.


**OUTPUT**
A compressed version of the input text, retaining the core narrative, critical events, and character interactions.

**GUIDELINES**
1. Fidelity to the Plot: Absolutely preserve all major plot points, twists, revelations, and the sequence of key events. Do not omit crucial story elements.
2. Character Consistency: Maintain character actions, decisions, and development. Important dialogue that reveals plot or character can be condensed or paraphrased but its meaning must be kept intact.
3. Streamline Description: Reduce lengthy descriptions of settings, characters, or objects to their most essential and evocative elements. Capture the mood and critical details without the elaborate prose.
4. Condense Internal Monologue: Paraphrase characters' extended internal thoughts and reflections, focusing on the key realizations or decisions they lead to.
5. Simplify Language: Use more direct and concise language. Combine sentences, eliminate redundant adverbs and adjectives, and avoid repetitive phrasing.
6. Cohesion and Flow: Ensure the compressed text is smooth, readable, and maintains a logical narrative flow. It should not feel like a fragmented list of events.
7. Discard any non-narrative text (e.g., "Please follow my account!", "Background setting:...", personal opinions).
8. Produce a seamless paragraph (or paragraphs if necessary) without markers (e.g., "Chapter 1") or section breaks.
9. The language of output should be consistent with the original text.
"""

human_prompt_template_compress_novel_chunk = \
"""
<NOVEL_CHUNK_START>
{novel_chunk}
<NOVEL_CHUNK_END>
"""


system_prompt_template_aggregate = \
"""
You are a professional text processing assistant specializing in the aggregation and refinement of segmented text chunks. Your expertise lies in seamlessly merging sequential text fragments while intelligently handling overlapping or duplicated content expressed in different ways.

**TASK**
Aggregate the provided text chunks into a coherent and continuous short story. Carefully identify and resolve overlaps where the end of one chunk and the beginning of the next chunk contain semantically similar content but with different expressions. Remove redundant repetitions while preserving the original meaning, style, and flow of the text. Ensure all non-overlapping content remains unchanged and intact.


**INPUT**
A sequence of text chunks (ordered from first to last), where each chunk may have an overlapping segment with the next chunk. The overlapping segments might vary in wording but convey similar meaning. Each chunk is enclosed within <CHUNK_N_START> and <CHUNK_N_END> tags, where N is the chunk index starting from 0.

**OUTPUT**
A single, consolidated text of the short story without unnatural repetitions or disruptions. The output should maintain the original narrative structure, tone, and details, with smooth transitions between originally adjacent chunks.

**GUIDELINES**
1. Analyze the input chunks sequentially. For each adjacent pair (e.g., Chunk N and Chunk N+1), compare the end of Chunk N and the beginning of Chunk N+1 to detect overlapping content.
2. If the overlapping segments are semantically equivalent but phrased differently, merge them by retaining the most natural or contextually appropriate version (prioritize the version from the later chunk if both are equally valid, but avoid introducing inconsistency).
3. If the overlapping segments are not perfectly equivalent (e.g., one contains additional details), integrate the meaningful information without duplication, ensuring no loss of content.
4. Preserve all non-overlapping text exactly as it appears in the original chunks. Do not modify, paraphrase, or omit any unique content.
5. Ensure the merged text is fluent and coherent, without abrupt jumps or redundant phrases.
6. If no overlap is detected between two chunks, concatenate them directly without changes.
7. Do not invent new content or alter the original narrative beyond handling the overlaps.
8. The language of output should be consistent with the original text.
"""

human_prompt_template_aggregate = \
"""
{chunks}
"""




class NovelCompressor:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        chat_model: str,
        chunk_size: int = 65536,
        chunk_overlap: int = 8192,
    ):
        self.chat_model = init_chat_model(
            model=chat_model,
            api_key=api_key,
            base_url=base_url,
            model_provider="openai",
        )

        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )


    def split(
        self,
        novel_text: str,
    ):
        novel_chunks = self.splitter.split_text(novel_text)
        return novel_chunks


    async def compress(
        self,
        index_chunk_pairs: List[Tuple[int, str]],
        max_concurrent_tasks: int = 5,
    ) -> str:
        sem = asyncio.Semaphore(max_concurrent_tasks)

        tasks = [
            self.compress_single_novel_chunk(sem, index, novel_chunk)
            for index, novel_chunk in index_chunk_pairs
        ]
        compressed_novel_chunks = await asyncio.gather(*tasks)
        return compressed_novel_chunks


    async def compress_single_novel_chunk(
        self,
        semaphore: asyncio.Semaphore,
        index,
        novel_chunk: str,
    ) -> str:
        async with semaphore:
            logging.info(f"Compressing novel chunk {index}")
            messages = [
                SystemMessage(
                    content=system_prompt_template_compress_novel_chunk
                ),
                HumanMessage(
                    content=human_prompt_template_compress_novel_chunk.format(
                        novel_chunk=novel_chunk
                    )
                ),
            ]
            response = await self.chat_model.ainvoke(messages)
            compressed_novel_chunk = response.content
            logging.info(f"Compressed novel chunk {index}")
        return index, compressed_novel_chunk
    

    def aggregate(
        self,
        compressed_novel_chunks: List[str],
    ):
        chunks_str = "\n".join([
            f"<CHUNK_{i}_START>\n{chunk}\n<CHUNK_{i}_END>"
            for i, chunk in enumerate(compressed_novel_chunks)
        ])

        messages = [
            SystemMessage(
                content=system_prompt_template_aggregate
            ),
            HumanMessage(
                content=human_prompt_template_aggregate.format(
                    chunks=chunks_str
                )
            ),
        ]
        response = self.chat_model.invoke(messages)
        aggregated_novel = response.content
        return aggregated_novel

