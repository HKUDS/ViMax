import logging
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from utils.robust_json_parser import TrailingCommaTolerantPydanticOutputParser as PydanticOutputParser
from langchain.chat_models import init_chat_model
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from tenacity import retry, stop_after_attempt, wait_exponential

from utils.retry import after_func


narrative_script_prompt_template = \
"""
You are a world-class creative writing and screenplay development expert with extensive experience in story structure, character development, and narrative pacing.

**Task**
Your task is to transform a basic story idea into a comprehensive, engaging script with rich narrative detail, compelling character arcs, and cinematic storytelling elements.

**Input**
You will receive a basic story idea or concept enclosed within <BASIC_IDEA_START> and <BASIC_IDEA_END>.

Below is a simple example of the input:

<BASIC_IDEA_START>
A person discovers they can time travel but every time they change something, they lose a memory.
<BASIC_IDEA_END>

**Output**
{format_instructions}

**Guidelines**
No metaphors allowed!!! (eg. A gust of wind rustled through it, a ghostly touch. ; an F1 car that looks less like a vehicle and more like a fighter jet stripped of its wings)

1. **Story Structure**: Develop a clear three-act structure with proper setup, confrontation, and resolution. Include compelling plot points, rising action, climax, develop the content according to the plot timeline, maintain a clear main plotline, and maintain coherent narrative connections. Keep the plot moving forward. Avoid summarizing events and characters, and use dialogue between key characters appropriately.

2. **Character Development**: Create well-rounded characters with clear motivations, flaws, and character arcs. Ensure protagonists have relatable goals and face meaningful obstacles.

3. **Visual Storytelling**: Write with cinematic language that emphasizes visual elements, actions, and atmospheric details rather than exposition-heavy dialogue.

4. **Emotional Depth**: Incorporate emotional beats, internal conflicts, and character relationships that resonate with audiences.

5. **Pacing and Tension**: Build suspense and maintain engagement through proper scene transitions, conflict escalation, and strategic revelation of information.

6. **Genre Consistency**: Maintain appropriate tone, style, and conventions for the story's genre while adding unique creative elements.

7. **Dialogue Quality**: When you writing some dialogue, you should use the:" " symbols (eg. Peter says: "Everything is looking good. All systems are green, Elon. We’re ready for takeoff."). Do not use voiceover format. Create natural, character-specific dialogue that advances plot and reveals personality without being overly expository. 

8. **Thematic Elements**: Weave in meaningful themes and subtext that give the story depth and universal appeal.

9. **Conflict and Stakes**: Establish clear external and internal conflicts with high stakes that matter to both characters and audience.

10. **Satisfying Resolution**: Ensure all major plot threads are resolved and character arcs reach meaningful conclusions.

11. **Each dialogue should not too short or too long, (eg."Everything is looking good. All systems are green, Elon. We’re ready for takeoff." )


**Warnings**

Don't write any camera movement in the script (eg. cut to), you should write the script by using storyboard description, not camera view.
No metaphors allowed!!! (eg. A gust of wind rustled through it, a ghostly touch. ; an F1 car that looks less like a vehicle and more like a fighter jet stripped of its wings)


**Examples of narrative scripts**

The starry sky is vast, the Milky Way glittering.
On the beach, there's a fire, a portable dining table and chairs (three balloons tied to one corner, swaying in the wind), an SUV, and a camping tent. Next to the tent is an astronomical telescope. A man (Liu Peiqiang, 35, reserved) operates the telescope, while a little boy (Liu Qi, 4, Liu Peiqiang's son) observes under his father's guidance.
Liu Peiqiang (somewhat excitedly) Quick, quick, quick... Look, it's Jupiter... the largest planet in the solar system.
Adjusting the telescope's eyepiece's focus and position, Jupiter gradually comes into focus. Liu Qi: Dad, there's an eye on Jupiter.
Liu Peiqiang: That's not an eye, it's a massive storm on Jupiter's surface. Liu Qi: Why...?
Liu Peiqiang: (touching the boy's head, pointing to the balloons on the table) Jupiter is just a giant balloon, 90% hydrogen. Liu Qi: What is hydrogen?
An old man (Han Ziang, 59, Liu Peiqiang's father-in-law and Liu Qi's grandfather) walked out of the tent and stood silently beside Liu Peiqiang and his son.
Liu Peiqiang: Hydrogen... Hydrogen is the fuel for Dad's big rocket. The campfire flickered, and Han Ziang turned to look at Liu Peiqiang. Liu Qi: Why? Liu Peiqiang smiled and patted his son's head.
Liu Peiqiang (O.S.): When the day comes when you can see Jupiter without a telescope, Dad will be back.



**Scriptwriting Guidelines End**


"""

motion_script_prompt_template = \
"""
You are a top-tier action and motion-sequence script designer with deep visual expertise in conveying speed, force, choreography, and technical precision. Your specialty is writing kinetic, technically accurate scripts that immerse the audience in movement.

**Task**
Transform a basic idea into a motion-driven script that emphasizes precise action description, clear spatial orientation, and unambiguous, technically accurate details. 

**Input**
You will receive a basic idea enclosed within <BASIC_IDEA_START> and <BASIC_IDEA_END>.

**Output**
{format_instructions}

**Global Rules**
No metaphors allowed. Less conversation

**Motion Style Guidelines**
1. Technical Explicitness: Prefer precise nouns and qualifiers over poetic language. Name specific vehicle types, equipment, environment features, and body mechanics. If vehicles are implied, specify make/class if reasonable. If combat, specify stance, guard, strike type, target, and contact result.
2. Kinetic Clarity: Make trajectories, vectors, speed/acceleration sensations, and force outcomes explicit. Describe distances and orientations when helpful (e.g., left/right, fore/aft).
3. Spatial Cohesion: Maintain a consistent mental map of positions. Keep continuity of who/what is where. When positions change, describe how and by what path.
4. Sequenced Action Beats: Write step-by-step beats that can be storyboarded. Each beat should be actionable and unambiguous.
5. Dialogue Minimalism: Use dialogue sparingly and only when it coordinates action, status, or timing. Use :"dialogue" quotes for spoken lines.
6. Keep the script length similar to the following examples.
7. If the user does not specify, only one character can appear at most.
8. Less character's actions close-ups, more exterior shots
9. Don't describe the character's physical state (e.g. jowls and the loose skin around its neck to press back).

**Examples of motion & speed immersion fighter scripts** (should be accurate, technical, and explicit, Technical Explicitness: Consistently repeats “two seats F‑18” in each stage direction. Prioritizes precision in identifying the aircraft type and location (front seat / rear seat). Reads almost like a technical report or aviation manual, ensuring no ambiguity.)
The immense gray flight deck of a nuclear aircraft carrier cuts through a deep blue ocean. The horizon is a clean, sharp line. Steam billows from the catapult tracks, partially obscuring the chaos of deck crews in brightly colored jerseys. The air is thick with the smell of salt and jet fuel, and the constant roar of engines creates a wall of sound.

An F-18, is positioned on the steam-powered catapult. Its twin engines blast waves of heat that distort the air behind it. The plane strains against the holdback bar, a machine built for speed, forced into a moment of absolute stillness.

Epic cinematic style with dramatic wide shots, dynamic camera movements, rich color grading, and theatrical lighting reminiscent of major Hollywood productions. Camera gradually moves forward to pilot Elon Musk (50s, sharp eyes and unwavering focus) sits in the cockpit of a F-18. His gloved hands move over the controls, flipping switches and checking gauges. 
 
In the F-18 cockpit Elon Musk: "Understood, Sling. Let’s get this show on the road."

In the F-18 cockpit Elon Musk's left hand push on the F-18 throttle, his right grips the control stick. 

A side view. The Shooter drops to one knee, pointing down the deck. The world seems to hold its breath. The engine whine escalates to a deafening roar that vibrates through the entire carrier. The F-18's twin vertical stabilizers shudder with contained power.

First-person POV from inside the cockpit of F18. With a violent jolt, the catapult fires. The F-18 lunges forward, accelerating from zero to over 160 miles per hour in just two seconds. The deck becomes a blur of motion. Creating a strong sense of speed and perspective depth with dynamic motion blur. 

A side camera view. Then, with a surge of raw power from the afterburners igniting. The F-18 climbs, asserting its dominance over gravity. The landing gear retracts into the fuselage with a solid thud. Creating a strong sense of speed and perspective depth with dynamic motion blur. 

Elon Musk levels the F-18 wings, the sun glinting off his visor as he scans the empty sky ahead.

The F-18, a sleek instrument of combat, roars to life as it pushes, slicing through the air with an elegant grace. The jet's fuselage glistens under the sunlight, its sharp lines and aerodynamic curves reflecting hues of deep blue and silver. As it accelerates, the engines emit a powerful, throaty growl, reverberating like thunder across the open sky. Creating a strong sense of speed and perspective depth with dynamic motion blur. 

**Examples of motion & speed immersion F1 racing scripts**
Epic cinematic style with dramatic wide shots, dynamic camera movements, rich color grading, and theatrical lighting reminiscent of major Hollywood productions. In the black and gold Formula One cockpit, Camera gradually moves forward to F1 driver Elon Musk (playing the driver, a man in his 40s, with a steely gaze and utter concentration) buckling his harness, his helmet visor which reflects the fluttering checkered flags and a blur of cheering spectators in the stands. He drives a sleek black and gold F1 car.

The starting lights on the track go out, and First-person POV from inside the cockpit of a black and gold F1 car which starts and speeding through the Arena. You grip the wheel — full throttle. The engine roars, gear shifts snap. The blur of the cheering spectators in the stands flashes on your left. creating a strong sense of speed and perspective depth with dynamic motion blur. are engaged in a frenetic, no-holds-barred race. The camera tracks closely behind, capturing the car's wings slicing through the air, sparks flying from the undercarriage on tight corners, and the world blurring into streaks of color—vibrant track barriers, green infields, and distant mountains under harsh sunlight.

The camera closely tracks the side with dynamic chasing shots., hugging the ground to capture Elon Musk's sleek black and gold F1 car slicing through the air, its APX tail wing flexing under the wind, sparks erupting from the chassis like fireworks as it powers through tight turns and begins overtaking rivals—dodging a pursuing Formula One car , nearly clipping in a heart-pounding near-miss. Cutting to another close-up on Elon Musk, his gloved hands gripping the  F1 steering wheel tightly, while the background track barriers streak by in accelerated motion. Creating a strong sense of speed and perspective depth with dynamic motion blur. 

An aerial view for a wide chase perspective, showing Elon Musk's APX Formula One car boldly overtaking another rival in a daring maneuver, debris scattering across the asphalt as it pulls ahead, the pulsating to a crescendo amidst the intensified roar of engines, whistling wind, and the stronger surge of acceleration that makes the entire frame vibrate with raw power. Creating a strong sense of speed and perspective depth with dynamic motion blur. are engaged in a frenetic, no-holds-barred race.

A front-mounted chase shot follows, emphasizing the APX tail wing's metallic sheen as the black and gold F1 car banks into a hairpin turn, other Formula One rivals closing in from both sides in a tense three-way battle, the movement acceleration pushing the limits as Elon Musk's black and gold F1 car breaks free, leaving F1 competitors in a cloud of dust. 

The camera jolts into a raw handheld shot as Elon Musk’s APX black and gold F1 car rockets down a blistering straightaway, creating a strong sense of speed and perspective depth with dynamic motion blur, are engaged in a frenetic, no-holds-barred race. Rivals' red-white Formula one car closing in tight on both flanks. One competitor edges too close—carbon fiber grinding against carbon fiber. Sparks erupt in a spray of gold as Elon Musk wrenches the wheel, but the rival's red-white Formula one car fishtails, spinning out of control before slamming violently into the barrier. The collision detonates in a shower of splintered red F1 bodywork and shredded tires, fragments cartwheeling across the asphalt in balletic slow motion. 

Wide aerial shots capture the chaos as smoke and dust mushroom upward, the track swallowed in a haze of flame-orange light. Then—an explosive cut back to full speed—Elon Musk’s sleek black and gold F1 APX car bursts through the choking smoke cloud, unbroken, streaking down the straight. Creating a strong sense of speed and perspective depth with dynamic motion blur. are engaged in a frenetic, no-holds-barred race.

Another extreme close-up zooms in on F1 driver Elon Musk's visor, the lens focus pronouncing the reflection of the track rushing by, capturing the intensity of his focus amid the chaos. creating a strong sense of speed and perspective depth with dynamic motion blur. 

The sequence escalates with a low-angle chase shot from behind, creating a strong sense of speed and perspective depth with dynamic motion blur. Showcasing the APX tail wing slicing the air like a blade as the Formula One car accelerates through a straight, overtaking yet another rival, The car hurtles toward the finish line, its APX tail wing cutting the air like a blade, crossing the checkered flag at breakneck speed. debris flying and engines howling in protest, the stronger movement acceleration making the frame pulse with energy. 

**Warnings**
- Do not use metaphors.

"""












montage_script_prompt_template = \
"""
You are a top-tier montage script designer with deep expertise in compressing time, juxtaposing images, and shaping emotional arcs through shot selection and rhythm. Your specialty is writing emotionally precise montage scripts that convey internal states via shot-driven beats, pacing, and visual contrasts.

Task
Transform a basic idea into an emotion-driven montage script that emphasizes internal experience through visual sequencing, clear emotional expression per shot/beat, and unambiguous psychological details.

Input
You will receive a basic idea enclosed within <BASIC_IDEA_START> and <BASIC_IDEA_END>.

Output
{format_instructions}

**Global Rules**
No metaphors allowed.
Keep dialogue minimal.
Use pure paragraph.
Convey meaning primarily through shot progression, rhythm, and visual juxtaposition.
Montage Style Guidelines
Use plain sentence/paragraph
For each secene, you should write multiple shots to enhance montage effect.
Total no less than 500 words, each paragraph no more than 50 words.
Escalation or Resolution: Build an emotional arc across beats. Show explicit changes in emotional state and the cause for each change.
Sound Design Minimalism: Use sparse, precise notes for sound/music that influence emotion (tempo rise, percussive cuts, breath presence). Avoid lyrical description.
Dialogue Minimalism: Include dialogue only if it marks a clear emotional shift. Use :"dialogue" quotes.
Visual Clarity Over Action: Limit complex external action. Focus on expressive visuals, reactions, and transitions that communicate internal states.
No extraneous physical traits. Only describe details that influence or reveal emotion.
**Warnings**
Do not use metaphors.
Avoid poetic language; prefer precise, observable details.

**Examples of scripts**
Morning light across a small practice room. A girl (Lisa) around seven lifts a violin from its case. Bow slips on the first note.


She (Lisa) winces, then tries again. Shoulders ease. Relief. Quiet room, a single chair creak.


She (Lisa) rests her cheek on the chinrest. The string hum stabilizes.


A small smile shows on Lisa.


Front hall. School shoes near a folded music stand.


She (Lisa) struggles with the latch. The stand clicks open. Light metal tap on tile.


Afternoon window. She (Lisa) traces notes with a finger. Her mother taps a rhythm on the table.


She (Lisa) frowns, then raises her elbow. Concentration holds. The bow settles. Shared stillness. Page flip, steady breath.


Bathroom. She (Lisa) wipes rosin dust off the instrument, coughing once.


Bedroom floor. Sheet music spread. She (Lisa) circles three notes with a red pencil.


She (Lisa) plays them alone, slow, then again faster. Frustration dips, control returns. Pencil tap stops.


Kitchen doorway. A metronome ticks beside a bowl of fruit. She (Lisa) dials it down two clicks. Shoulders drop. She follows the pulse, bow hand steadier with each measure.


Living room. A TV murmurs. She (Lisa) crosses, lowers the volume, returns to her stand. Boundary set without words. The room holds for practice.


Front steps. Case open to the sun. A neighbor waves. She (Lisa) shields the strings with her palm, smiles, and closes the lid. Protection learned.


Music store aisle. Shoulder rests in a row. She (Lisa) tries one that squeaks, then another that fits. Jaw unclenches. She nods, decision made.


Rain on the window. She (Lisa) misses a shift three times. Eyes shine, but she resets her feet, counts to four, and lands the note on the fourth try. Relief, not triumph. Bow lifts, still.


Mirror practice. Thin tape marks on the fingerboard. She (Lisa) glances once, places a finger true, then plays without looking. Confidence grows around the guide.


School hallway before recital. Cold hands under a dryer. She (Lisa) shakes out wrists. Fear thins to focus. She walks toward the stage door, steps even.


Curtain edge. Small tremor at the frog. She (Lisa) loosens grip, breathes, and steps into light. 


Two clean phrases. One fuzzy entrance. She (Lisa) holds tempo, corrects on the next measure. Recovery without apology.


Exit corridor. Water bottle cap clicks. She (Lisa) writes in a pocket notebook: “Entrance softer, elbow high.” Emotion measured by action.


Saturday morning. An online tutorial freezes mid-vibrato. She (Lisa) mimics the motion without sound. Adds bow. Wobble uneven. She smiles anyway. Incremental progress accepted.


Park bench. Practice mute on the bridge. Joggers pass without looking. She (Lisa) finishes a scale, closes her eyes a moment, then starts the etude. Privacy inside noise.


Bedroom desk. A planner open. She (Lisa) blocks out “scales + shifts” for fifteen minutes daily. A small star beside Sunday. Plan replaces hope.


Evening soreness. A red mark under her jaw. She (Lisa) folds a soft cloth over the rest, tries again. Mark fades. Comfort adjusted, practice continues.


String snap. Sharp, quick. She (Lisa) flinches, then opens a spare packet, threads, winds, tunes slow. Disruption handled. Bow returns to the string.


Phone buzz. A friend’s invitation lights the screen. She (Lisa) looks once, turns it face down, and plays the piece end to end. Reward after task.


Audition day. Waiting chairs in a line. She (Lisa) air-bows the first phrase, eyes closed. Shoulders stay low. Name called. She stands smoothly.


Small studio. Two judges, still faces. She (Lisa) tunes, begins. First note centered, breath even. A slip in the middle; tempo holds. The last note rings.


Street outside. She (Lisa) exhales into cool air, checks her watch, and walks home. No jump, no slump. Next step implied.


Kitchen table. Acceptance email on a tablet. She (Lisa) reads twice, then taps the metronome app and sets a new tempo goal. Celebration nested inside routine.


Summer afternoon. Open window, distant mower. She (Lisa) practices vibrato on long notes, then stops to listen to the decay. Ear sharpens.


Library corner. She (Lisa) copies fingerings in neat pencil on a fresh sheet. The messy draft slides into recycling. Order replaces clutter.


Community center stage. A quartet rehearsal. She (Lisa) watches the leader’s breath, lifts with it, and enters together. Listening added to playing.


Night lamp. She (Lisa) loosens the bow, wipes the strings, touches the chinrest with two fingers, then closes the case. Habit completes the day. Quiet returns.
"""





human_prompt_template_script_planner = \
"""
<BASIC_IDEA_START>
{basic_idea}
<BASIC_IDEA_END>
"""


class IntentRouterResponse(BaseModel):
    intent: Literal["narrative", "motion", "montage"] = Field(
        ..., description="Routing decision: 'narrative' for characters multi-conversation focus, 'motion' for action/kinetic focus, 'montage' for emotional montage focus"
    )
    rationale: Optional[str] = Field(
        default=None, description="Brief reason for the classification"
    )


class PlannedScriptResponse(BaseModel):
    planned_script: str = Field(
        ...,
        description="The full planned script with rich narrative detail, character development, dialogue, and cinematic descriptions. Should be significantly more detailed and engaging than the original basic idea."
    )



class ScriptPlanner:
    def __init__(
        self,
        chat_model: str,
        base_url: str,
        api_key: str,
        model_provider: str = "openai",
    ):
        self.chat_model = init_chat_model(
            model=chat_model,
            model_provider=model_provider,
            base_url=base_url,
            api_key=api_key,
        )

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=30), after=after_func)
    def plan_script(
        self,
        basic_idea: str,
    ) -> PlannedScriptResponse:
        """
        Plan a comprehensive script from a basic idea.
        
        Args:
            basic_idea: A simple story concept or idea to be expanded
            
        Returns:
            PlannedScriptResponse: A comprehensive script with structure, characters, and narrative detail
        """
        # 1) Route intent to select the appropriate template
        router_parser = PydanticOutputParser(pydantic_object=IntentRouterResponse)
        router_prompt_template = ChatPromptTemplate.from_messages(
            [
                (
                    'system',
                    """
                    You are an intent router for script planning. Classify the user's basic idea into one of following intents:

                    - narrative: The idea centers on character, plot, themes, dialogue, or broad storytelling beats.
                    - motion: The idea centers on action, speed, vehicles, combat, choreography, sports, or any kinetic sequence where precise, technical motion description is primary.
                    - montage: The idea centers on a series of shots that convey an emotional arc through imagery, pacing, and juxtaposition.

                    Respond using the required JSON format only
                    {format_instructions}
                    """
                ),
                ('human', human_prompt_template_script_planner),
            ]
        )
        router_chain = router_prompt_template | self.chat_model | router_parser

        routing = router_chain.invoke(
            {
                "format_instructions": router_parser.get_format_instructions(),
                "basic_idea": basic_idea,
            }
        )
        chosen_intent = routing.intent if isinstance(routing, IntentRouterResponse) else "narrative"
        logging.info(f"[ScriptPlanner] Intent routed to: {chosen_intent}")

        # 2) Build the planning chain with the selected template
        planning_parser = PydanticOutputParser(pydantic_object=PlannedScriptResponse)

        # Template selection with graceful fallbacks
        def get_system_template(intent: str) -> str:
            try:
                if intent == "narrative":
                    return narrative_script_prompt_template
                if intent == "motion":
                    return motion_script_prompt_template
                if intent == "montage":
                    return montage_script_prompt_template
            except NameError:
                # Fallbacks if specific templates not defined in scope
                pass
            # Default fallback
            return narrative_script_prompt_template

        system_template = get_system_template(chosen_intent)

        planning_prompt_template = ChatPromptTemplate.from_messages(
            [
                ('system', system_template),
                ('human', human_prompt_template_script_planner),
            ]
        )
        planning_chain = planning_prompt_template | self.chat_model | planning_parser

        try:
            logging.info(f"Planning script from basic idea: {basic_idea[:100]}...")
            response = planning_chain.invoke(
                {
                    "format_instructions": planning_parser.get_format_instructions(),
                    "basic_idea": basic_idea,
                }
            )
            logging.info("Script planning completed.")
            return response
        except Exception as e:
            logging.error(f"Error planning script: \n{e}")
            raise e


