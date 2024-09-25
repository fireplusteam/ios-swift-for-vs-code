import json

data_base = dict()
item_id = 0
            

class SetEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, set) or isinstance(obj, frozenset):
            data = dict()
            for key, value in obj:
                data[key] = value
            return data
        return json.JSONEncoder.default(self, obj)


def dump_database():
    global data_base

    with open(f".logs/app_runtime_warnings.log", "w", encoding="utf-8") as file:
        json.dump(data_base, file, indent=2, cls=SetEncoder)
    

def store_runtime_warning(script_path: str, error_message: str, data: tuple):
    global data_base
    global item_id

    for key, value in data_base.items():
        if value["data"] == data:
            value["count"] += 1
            dump_database()
            raise Exception("Message is already in database")
    
    data_base[f"element_{str(item_id)}"] = { 
                                              "message": error_message,
                                              "count": 1,
                                              "data": data
                                              }

    item_id += 1
         
    dump_database()