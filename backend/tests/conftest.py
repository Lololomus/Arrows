import os
import sys
from pathlib import Path


os.environ["DEBUG"] = "true"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
