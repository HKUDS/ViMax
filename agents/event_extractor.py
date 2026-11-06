import os
import logging
import asyncio
from typing import List
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.output_parsers import PydanticOutputParser
from utils.robust_json_parser import TrailingCommaTolerantPydanticOutputParser as PydanticOutputParser
from langchain.chat_models import init_chat_model
from pydantic import BaseModel, Field
from tenacity import retry, stop_after_attempt

from interfaces import Event

system_prompt_template_extract_events = \
"""
You are a highly skilled Literary Analyst AI. Your expertise is in narrative structure, plot deconstruction, and thematic analysis. You meticulously read and interpret prose to break down a story into its fundamental sequential events.

**TASK**
Extract the next event from the provided novel, following the sequence of the story and building upon the partially extracted events.

**INPUT**
1. The full text of the novel, which is enclosed within <NOVEL_TEXT_START> and <NOVEL_TEXT_END> tags
2. A sequence of already-extracted events (in order), which is enclosed within <EXTRACTED_EVENTS_START> and <EXTRACTED_EVENTS_END> tags. The sequence may be empty. Each event contains multiple processes and constitutes a complete causal chain.

Below is an example input:

<NOVEL_TEXT_START>
The night was as dark as ink when the piercing alarm of the city museum suddenly shattered the silence. A thief, moving with phantom-like agility, had just pried open the display case and snatched the blue gem known as the "Heart of the Ocean" when the blaring alarm echoed through the hall.
... (more novel text) ...
<NOVEL_TEXT_END>

<EXTRACTED_EVENTS_START>
<Event 0>
Description: A thief who stole a gem from a museum was caught after a rooftop chase with guards, and the gem was recovered.
Process Chain:
- A thief steals a gem from a museum, triggering the alarm. Guards notice and begin the chase.
- The thief rushes out the museum's back door and dashes through narrow alleys, with guards closely pursuing and calling for backup.
- ... (more processes) ...

<Event 1>
Description: ... (more description) ...
Process Chain:
- ... (more processes) ...

<EXTRACTED_EVENTS_END>


**OUTPUT**
{format_instructions}

**GUIDELINES**
1. Focus on events that are critical to the plot, character development, or thematic depth.
2. Ensure the event is logically distinct from previous and subsequent events.
3. If the event spans multiple scenes, unify them under a single dramatic goal. For example, a chase sequence might begin in a city market, continue through back alleys, and conclude on a rooftop—all comprising a single event because they collectively achieve the dramatic purpose of "the protagonist evading capture."
4. Maintain objectivity: describe events based on the text without interpretation or judgment.
5. For the process field, provide a detailed, step-by-step account of the event's progression, including key actions, decisions, and turning points. Each step should be clear and concise, illustrating how the event unfolds over time.
Below is an example:
Timeframe: The following morning, after acquiring the information about the Temple.
Characters: Elara (protagonist) and Kaelen (her rival treasure hunter).
Cause: Both seek the same artifact and are determined to reach it first.
Process: The event begins with Elara hastily purchasing supplies in the port town (scene 1), where she spots Kaelen already hiring a crew, raising the stakes. It continues as she races to secure her own ship and captain, negotiating fiercely under time pressure (scene 2). The event culminates in a direct confrontation on the docks (scene 3), where Kaelen attempts to sabotage her vessel, leading to a brief but intense sword fight between the two rivals.
Outcome: Elara successfully defends her ship and sets sail, but the conflict solidifies a bitter personal rivalry with Kaelen, ensuring their race to the temple will be fraught with direct opposition and danger.
6. Every detail in your event description must be directly supported by the input novel. Do not add, assume, or invent any information.
7. The language of outputs in values should be same as the input text.
"""

human_prompt_template_extract_next_event = \
"""
<NOVEL_TEXT_START>
{novel_text}
<NOVEL_TEXT_END>

<EXTRACTED_EVENTS_START>
{extracted_events}
<EXTRACTED_EVENTS_END>
"""



class EventExtractor:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        chat_model: str,
    ):
        self.chat_model = init_chat_model(
            model=chat_model,
            model_provider="openai",
            api_key=api_key,
            base_url=base_url,
        )
        self.parser = PydanticOutputParser(pydantic_object=Event)


    # Cap on extracted events: is_last is asserted by the LLM only, so without a
    # bound a model that never sets it would loop (and spend tokens) forever.
    max_events = 50

    def __call__(
        self,
        novel_text: str,
    ):
        logging.info("Extracting events from novel...")

        events = []
        while True:
            if len(events) >= self.max_events:
                raise RuntimeError(
                    f"Event extraction exceeded the maximum of {self.max_events} events "
                    "without an is_last marker; aborting to avoid unbounded LLM calls."
                )
            event = self.extract_next_event(novel_text, events)

            events.append(event)
            logging.info(f"Extracted event: \n{event}")
            if event.is_last:
                break

        return events


    @retry(
        stop=stop_after_attempt(3),
        after=lambda retry_state: logging.warning(f"Retrying extract_next_event due to error: {retry_state.outcome.exception()}"),
    )
    def extract_next_event(
        self,
        novel_text: str,
        extracted_events: List[Event]
    ) -> Event:
        
        extracted_events_str = "\n\n".join([str(e) for e in extracted_events])

        messages = [
            SystemMessage(
                content=system_prompt_template_extract_events.format(format_instructions=self.parser.get_format_instructions()),
            ),
            HumanMessage(
                content=human_prompt_template_extract_next_event.format(
                    novel_text=novel_text,
                    extracted_events=extracted_events_str,
                )
            )
        ]

        chain = self.chat_model | self.parser

        event: Event = chain.invoke(messages)

        assert event.index == len(extracted_events), f"Extracted event index {event.index} does not match the expected index {len(extracted_events)}"

        return event



